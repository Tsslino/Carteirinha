import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// URL do Supabase fixa para evitar falhas de leitura de ambiente na Vercel
const supabaseUrl = 'https://yzziwlymtdqvzdkwlgjc.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Chave da API da Resend para envio do e-mail com Magic Link
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Função utilitária para gerar o hash seguro da senha (SHA-256)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
    // Configuração de Cabeçalhos CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // -------------------------------------------------------------
    // 1. ROTA DE LOGIN (CPF + SENHA)
    // -------------------------------------------------------------
    if (req.method === 'POST' && req.query.action === 'login') {
        if (!supabase) {
            return res.status(500).json({ error: 'Configuração da chave do Supabase ausente na Vercel.' });
        }
        
        const { cpf, senha } = req.body || {};
        if (!cpf || !senha) {
            return res.status(400).json({ error: 'Por favor, informe o CPF e a senha.' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');
        const senhaHash = hashPassword(senha);

        try {
            const { data, error } = await supabase
                .from('carteirinhas')
                .select('*')
                .eq('cpf', cpfLimpo)
                .single();
            
            if (error || !data) {
                return res.status(404).json({ encontrado: false, message: 'CPF não cadastrado.' });
            }

            if (data.senha !== senhaHash) {
                return res.status(401).json({ encontrado: false, message: 'Senha incorreta.' });
            }

            return res.status(200).json({ encontrado: true, ...data });
        } catch (dbError) {
            console.error('Erro ao realizar login:', dbError);
            return res.status(500).json({ error: 'Erro interno no servidor ao consultar login.' });
        }
    }

    // -------------------------------------------------------------
    // 2. ROTA SOLICITAR MAGIC LINK (ESQUECI A SENHA)
    // -------------------------------------------------------------
    if (req.method === 'POST' && req.query.action === 'solicitar-magic-link') {
        if (!supabase) {
            return res.status(500).json({ error: 'Configuração do Supabase indisponível.' });
        }

        const { cpf } = req.body || {};
        if (!cpf) {
            return res.status(400).json({ error: 'Informe o CPF para recuperar a senha.' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');

        try {
            const { data, error } = await supabase
                .from('carteirinhas')
                .select('email, nome')
                .eq('cpf', cpfLimpo)
                .single();

            if (error || !data || !data.email) {
                return res.status(404).json({ error: 'CPF não encontrado ou sem e-mail cadastrado.' });
            }

            // Gera um token aleatório e define o tempo de expiração para 15 minutos
            const token = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

            // Grava o token no registo do estudante
            await supabase
                .from('carteirinhas')
                .update({ reset_token: token, reset_expires: expires })
                .eq('cpf', cpfLimpo);

            // Define o domínio dinamicamente (Usa o host atual ou o link de produção)
            const host = req.headers['x-forwarded-host'] || req.headers.host || 'passatempodecarteirinha.vercel.app';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const magicLink = `${protocol}://${host}/redefinir.html?token=${token}`;

            // Dispara o e-mail caso a chave da Resend esteja configurada
            if (RESEND_API_KEY) {
                const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'DNE Oficial <onboarding@resend.dev>',
                        to: [data.email],
                        subject: 'Redefinição de Senha - DNE Oficial',
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                                <h2>Recuperação de Senha</h2>
                                <p>Olá, <b>${data.nome}</b>!</p>
                                <p>Recebemos um pedido para redefinir a senha da sua carteirinha digital.</p>
                                <p>Clique no botão abaixo para cadastrar uma nova senha (este link expira em 15 minutos):</p>
                                <p style="margin: 25px 0;">
                                    <a href="${magicLink}" style="background-color: #16a34a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Redefinir Minha Senha</a>
                                </p>
                                <p style="font-size: 12px; color: #777;">Se você não solicitou a alteração, por favor ignore este e-mail.</p>
                            </div>
                        `
                    })
                });

                if (!resendResponse.ok) {
                    const errData = await resendResponse.json();
                    console.error('Erro ao enviar e-mail via Resend:', errData);
                }
            }

            return res.status(200).json({ status: 'ok', message: 'Link mágico enviado com sucesso para o e-mail cadastrado!' });
        } catch (e) {
            console.error('Erro ao gerar Magic Link:', e);
            return res.status(500).json({ error: 'Erro interno ao processar a recuperação de senha.' });
        }
    }

    // -------------------------------------------------------------
    // 3. ROTA REDEFINIR SENHA (VIA MAGIC LINK TOKEN)
    // -------------------------------------------------------------
    if (req.method === 'POST' && req.query.action === 'redefinir-senha') {
        if (!supabase) {
            return res.status(500).json({ error: 'Configuração do Supabase indisponível.' });
        }

        const { token, novaSenha } = req.body || {};
        if (!token || !novaSenha) {
            return res.status(400).json({ error: 'Dados incompletos para redefinição.' });
        }

        try {
            const { data, error } = await supabase
                .from('carteirinhas')
                .select('cpf, reset_expires')
                .eq('reset_token', token)
                .single();

            if (error || !data) {
                return res.status(400).json({ error: 'O link de redefinição é inválido.' });
            }

            if (new Date() > new Date(data.reset_expires)) {
                return res.status(400).json({ error: 'Este link expirou. Por favor, solicite um novo.' });
            }

            const novaSenhaHash = hashPassword(novaSenha);

            // Atualiza a nova senha e limpa os campos do token
            await supabase
                .from('carteirinhas')
                .update({ 
                    senha: novaSenhaHash, 
                    reset_token: null, 
                    reset_expires: null 
                })
                .eq('cpf', data.cpf);

            return res.status(200).json({ status: 'ok', message: 'Senha alterada com sucesso! Já pode fazer o login.' });
        } catch (e) {
            console.error('Erro ao redefinir senha:', e);
            return res.status(500).json({ error: 'Erro ao redefinir a senha.' });
        }
    }

    // -------------------------------------------------------------
    // 4. ROTA REGISTAR / SALVAR CARTEIRINHA
    // -------------------------------------------------------------
    if (req.method === 'POST' && req.query.action === 'salvar') {
        if (!supabase) {
            return res.status(500).json({ error: 'Chave do Supabase ausente nas variáveis de ambiente da Vercel.' });
        }

        const dados = req.body;
        if (!dados || !dados.cpf || !dados.senha || !dados.email) {
            return res.status(400).json({ error: 'Dados incompletos. E-mail e senha são obrigatórios.' });
        }

        try {
            const cpfLimpo = dados.cpf.replace(/\D/g, '');
            const senhaHash = hashPassword(dados.senha);
            
            const { error } = await supabase
                .from('carteirinhas')
                .upsert([{ 
                    cpf: cpfLimpo, 
                    nome: dados.nome,
                    email: dados.email,
                    nascimento: dados.nascimento,
                    instituicao: dados.instituicao,
                    curso: dados.curso,
                    nivel: dados.nivel,
                    matricula: dados.matricula,
                    foto: dados.foto,
                    senha: senhaHash
                }]);

            if (error) throw error;

            return res.status(200).json({ status: 'ok', message: 'Carteirinha e conta salvas com sucesso.' });
        } catch (dbError) {
            console.error('Erro ao salvar no Supabase:', dbError);
            return res.status(500).json({ error: 'Erro ao registrar a carteirinha no banco de dados.' });
        }
    }

    // Token do Mercado Pago vindo das Variáveis de Ambiente da Vercel
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    // -------------------------------------------------------------
    // 5. ROTA GERAR PIX (MERCADO PAGO)
    // -------------------------------------------------------------
    if (req.method === 'POST') {
        if (!ACCESS_TOKEN) {
            return res.status(500).json({ error: 'Token do Mercado Pago (MP_ACCESS_TOKEN) não configurado na Vercel.' });
        }

        try {
            const { nome, cpf } = req.body || {};

            const paymentData = {
                transaction_amount: 10.00,
                description: 'Emissão DNE Oficial - Documento do Estudante',
                payment_method_id: 'pix',
                payer: {
                    email: 'estudante@dneoficial.com',
                    first_name: nome ? nome.split(' ')[0] : 'Estudante',
                    last_name: nome ? nome.split(' ').slice(1).join(' ') : 'DNE',
                    identification: {
                        type: 'CPF',
                        number: cpf ? cpf.replace(/\D/g, '') : '00000000000'
                    }
                }
            };

            const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `${Date.now()}-${Math.random()}`
                },
                body: JSON.stringify(paymentData)
            });

            const data = await mpResponse.json();

            if (!mpResponse.ok) {
                console.error('Erro Mercado Pago:', data);
                return res.status(400).json({ error: data.message || 'Erro ao gerar pagamento no Mercado Pago.' });
            }

            const qrCodeBase64 = data.point_of_interaction?.transaction_data?.qr_code_base64;
            const qrCode = data.point_of_interaction?.transaction_data?.qr_code;

            return res.status(200).json({
                id: data.id,
                status: data.status,
                qr_code_base64: qrCodeBase64,
                qr_code: qrCode
            });

        } catch (error) {
            console.error('Erro interno ao gerar Pix:', error);
            return res.status(500).json({ error: 'Erro interno ao processar pagamento.' });
        }
    }

    // -------------------------------------------------------------
    // 6. ROTA VERIFICAR STATUS DO PAGAMENTO
    // -------------------------------------------------------------
    if (req.method === 'GET' && req.query.action === 'verificar') {
        const paymentId = req.query.id;
        if (!paymentId) return res.status(400).json({ error: 'ID do pagamento não fornecido.' });

        try {
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`
                }
            });

            const paymentData = await mpResponse.json();

            if (!mpResponse.ok) {
                return res.status(400).json({ error: 'Erro ao consultar status no Mercado Pago.' });
            }

            return res.status(200).json({ status: paymentData.status });
        } catch (error) {
            console.error('Erro ao verificar pagamento:', error);
            return res.status(500).json({ error: 'Falha ao consultar gateway de pagamento.' });
        }
    }

    return res.status(405).json({ error: 'Método não permitido.' });
}