import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Aumenta o limite de tamanho do corpo da requisição na Vercel (importante para imagens Base64)
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '4mb',
        },
    },
};

const supabaseUrl = 'https://yzziwlymtdqvzdkwlgjc.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const RESEND_API_KEY = process.env.RESEND_API_KEY;

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
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

    // 1. ROTA DE LOGIN
    if (req.method === 'POST' && req.query.action === 'login') {
        if (!supabase) return res.status(500).json({ error: 'Configuração do Supabase ausente.' });
        
        const { cpf, senha } = req.body || {};
        if (!cpf || !senha) return res.status(400).json({ error: 'Informe o CPF e a senha.' });

        const cpfLimpo = cpf.replace(/\D/g, '');
        const senhaHash = hashPassword(senha);

        try {
            const { data, error } = await supabase
                .from('carteirinhas')
                .select('*')
                .eq('cpf', cpfLimpo)
                .single();
            
            if (error || !data) return res.status(404).json({ encontrado: false, message: 'CPF não cadastrado.' });
            if (data.senha !== senhaHash) return res.status(401).json({ encontrado: false, message: 'Senha incorreta.' });

            return res.status(200).json({ encontrado: true, ...data });
        } catch (dbError) {
            return res.status(500).json({ error: 'Erro interno.' });
        }
    }

    // 2. ROTA SOLICITAR MAGIC LINK
    if (req.method === 'POST' && req.query.action === 'solicitar-magic-link') {
        if (!supabase) return res.status(500).json({ error: 'Configuração do Supabase indisponível.' });
        const { cpf } = req.body || {};
        const cpfLimpo = cpf.replace(/\D/g, '');

        try {
            const { data, error } = await supabase.from('carteirinhas').select('email, nome').eq('cpf', cpfLimpo).single();
            if (error || !data || !data.email) return res.status(404).json({ error: 'CPF não encontrado.' });

            const token = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

            await supabase.from('carteirinhas').update({ reset_token: token, reset_expires: expires }).eq('cpf', cpfLimpo);

            const host = req.headers['x-forwarded-host'] || req.headers.host || 'passatempodecarteirinha.vercel.app';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const magicLink = `${protocol}://${host}/redefinir.html?token=${token}`;

            if (RESEND_API_KEY) {
                await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'DNE Oficial <onboarding@resend.dev>',
                        to: [data.email],
                        subject: 'Redefinição de Senha - DNE Oficial',
                        html: `<p>Olá, clique no botão para redefinir: <a href="${magicLink}">Redefinir Minha Senha</a></p>`
                    })
                });
            }

            return res.status(200).json({ status: 'ok' });
        } catch (e) {
            return res.status(500).json({ error: 'Erro interno.' });
        }
    }

    // 3. ROTA REDEFINIR SENHA
    if (req.method === 'POST' && req.query.action === 'redefinir-senha') {
        const { token, novaSenha } = req.body || {};
        try {
            const { data, error } = await supabase.from('carteirinhas').select('cpf, reset_expires').eq('reset_token', token).single();
            if (error || !data) return res.status(400).json({ error: 'Link inválido.' });
            if (new Date() > new Date(data.reset_expires)) return res.status(400).json({ error: 'Link expirado.' });

            const novaSenhaHash = hashPassword(novaSenha);
            await supabase.from('carteirinhas').update({ senha: novaSenhaHash, reset_token: null, reset_expires: null }).eq('cpf', data.cpf);
            return res.status(200).json({ status: 'ok' });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao redefinir a senha.' });
        }
    }

    // 4. ROTA REGISTAR / SALVAR CARTEIRINHA (Agora chamado ANTES do pagamento)
    if (req.method === 'POST' && req.query.action === 'salvar') {
        if (!supabase) return res.status(500).json({ error: 'Chave do Supabase ausente.' });

        const dados = req.body;
        if (!dados || !dados.cpf) return res.status(400).json({ error: 'Dados incompletos.' });

        try {
            const cpfLimpo = dados.cpf.replace(/\D/g, '');
            let senhaHash = null;
            if (dados.senha) {
                senhaHash = hashPassword(dados.senha);
            }
            
            // Grava na base de dados
            const payload = { 
                cpf: cpfLimpo, 
                nome: dados.nome,
                email: dados.email,
                nascimento: dados.nascimento,
                instituicao: dados.instituicao,
                curso: dados.curso,
                nivel: dados.nivel,
                matricula: dados.matricula,
                foto: dados.foto,
                status_pagamento: dados.status_pagamento || 'pendente'
            };

            // Se for um novo registo ou alteração de senha, incluímos a senha
            if (senhaHash) {
                payload.senha = senhaHash;
            }
            
            const { error } = await supabase.from('carteirinhas').upsert([payload]);

            if (error) throw error;

            return res.status(200).json({ status: 'ok', message: 'Carteirinha guardada com sucesso.' });
        } catch (dbError) {
            console.error('Erro ao guardar no Supabase:', dbError);
            return res.status(500).json({ error: 'Erro ao registar a carteirinha.' });
        }
    }

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    // 5. ROTA GERAR PIX
    if (req.method === 'POST') {
        if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Token do Mercado Pago não configurado.' });

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
                    identification: { type: 'CPF', number: cpf ? cpf.replace(/\D/g, '') : '00000000000' }
                }
            };

            const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `${Date.now()}-${Math.random()}` },
                body: JSON.stringify(paymentData)
            });

            const data = await mpResponse.json();

            if (!mpResponse.ok) return res.status(400).json({ error: data.message });

            return res.status(200).json({
                id: data.id,
                status: data.status,
                qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
                qr_code: data.point_of_interaction?.transaction_data?.qr_code
            });

        } catch (error) {
            return res.status(500).json({ error: 'Erro interno ao processar pagamento.' });
        }
    }

    // 6. ROTA VERIFICAR STATUS DO PAGAMENTO (Atualiza a BD se aprovado)
    if (req.method === 'GET' && req.query.action === 'verificar') {
        const paymentId = req.query.id;
        const cpf = req.query.cpf; // Recebe o CPF enviado pelo script.js
        if (!paymentId) return res.status(400).json({ error: 'ID do pagamento não fornecido.' });

        try {
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
            });

            const paymentData = await mpResponse.json();

            if (!mpResponse.ok) return res.status(400).json({ error: 'Erro ao consultar o Mercado Pago.' });

            // NOVO: Se estiver pago, atualiza diretamente o estado na base de dados
            if (paymentData.status === 'approved' && cpf && supabase) {
                await supabase
                    .from('carteirinhas')
                    .update({ status_pagamento: 'pago' })
                    .eq('cpf', cpf);
            }

            return res.status(200).json({ status: paymentData.status });
        } catch (error) {
            return res.status(500).json({ error: 'Falha ao consultar gateway de pagamento.' });
        }
    }

    return res.status(405).json({ error: 'Método não permitido.' });
}