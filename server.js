const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURAÇÕES DO SUPABASE
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Aviso: As variáveis de ambiente do Supabase não estão definidas.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configurações do Google Wallet
const ISSUER_ID = process.env.GOOGLE_ISSUER_ID || '338800000023214433'; 
const CREDENTIALS_PATH = './google-service-account.json';

// ==========================================
// ROTA RAIZ
// ==========================================
app.get('/', (req, res) => {
    res.send('API da Carteirinha DNE a funcionar com sucesso!');
});

// ==========================================
// ROTAS DA API DE PAGAMENTO E AUTENTICAÇÃO
// ==========================================
app.post('/api/pagamento', async (req, res) => {
    const { action } = req.query;
    
    // 1. Rota de Login do Estudante (SÓ PERMITE SE O PAGAMENTO ESTIVER APROVADO)
    if (action === 'login') {
        const { cpf, senha } = req.body;
        const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : '';
        try {
            const { data: estudante, error } = await supabase
                .from('carteirinhas')
                .select('*')
                .eq('cpf', cpfLimpo)
                .single();

            if (error || !estudante || estudante.senha !== senha) {
                return res.status(401).json({ error: 'CPF ou senha incorretos.' });
            }

            // SEGURANÇA: Se o pagamento não foi aprovado, bloqueia o acesso ao login
            if (estudante.status_pagamento !== 'approved') {
                return res.status(403).json({ error: 'Pagamento pendente. A sua carteirinha só será liberada após a confirmação do Pix.' });
            }

            return res.json({
                encontrado: true,
                ...estudante
            });
        } catch (err) {
            console.error('Erro no login:', err);
            return res.status(500).json({ error: 'Erro interno no servidor.' });
        }
    }

    // 2. Rota de Salvamento de Dados
    if (action === 'salvar' || req.body.cpf) {
        try {
            const dados = req.body;
            if (dados.cpf) {
                dados.cpf = dados.cpf.replace(/\D/g, ''); 
            }
            
            // Garante que se não vier status explícito, assume pendente
            if (!dados.status_pagamento) {
                dados.status_pagamento = 'pendente';
            }

            const { error } = await supabase
                .from('carteirinhas')
                .upsert([dados], { onConflict: 'cpf' });

            if (error) {
                console.error('Erro ao salvar no Supabase:', error);
                return res.status(400).json({ error: error.message });
            }
            return res.json({ success: true });
        } catch (err) {
            console.error('Erro interno ao salvar:', err);
            return res.status(500).json({ error: 'Erro interno ao salvar dados.' });
        }
    }

    // 3. Verificação de status do pagamento
    if (action === 'verificar') {
        const { id, cpf } = req.query;
        const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : '';

        try {
            const { data: estudante } = await supabase
                .from('carteirinhas')
                .select('status_pagamento')
                .eq('cpf', cpfLimpo)
                .single();

            if (estudante && estudante.status_pagamento === 'approved') {
                return res.json({ status: 'approved' });
            }

            return res.json({ status: 'pending' });
        } catch (e) {
            return res.json({ status: 'pending' });
        }
    }

    // Mock padrão para simulação do Pix
    return res.json({
        id: 'mock_payment_123',
        qr_code_base64: '',
        qr_code: '00020101021243650014br.gov.bcb.pix...'
    });
});

// ==========================================
// ROTA DA API DE CARTEIRAS DIGITAIS
// ==========================================
app.get('/api/carteira', async (req, res) => {
    const { action, cpf } = req.query;

    if (!cpf) {
        return res.status(400).json({ error: 'CPF não informado.' });
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    try {
        const { data: estudante, error } = await supabase
            .from('carteirinhas') 
            .select('*')
            .eq('cpf', cpfLimpo)
            .single();

        if (error || !estudante || estudante.status_pagamento !== 'approved') {
            return res.status(403).json({ error: 'Acesso negado. Carteirinha sem pagamento confirmado.' });
        }

        if (action === 'google') {
            const googleWalletUrl = gerarLinkGoogleWallet(estudante);
            return res.redirect(googleWalletUrl);
        } 
        else {
            return res.status(400).json({ error: 'Ação inválida.' });
        }

    } catch (err) {
        console.error('Erro na API de carteira:', err);
        return res.status(500).json({ error: 'Erro interno ao processar a carteira digital.' });
    }
});

function gerarLinkGoogleWallet(estudante) {
    const credentials = process.env.GOOGLE_CREDENTIALS_JSON 
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
        : require(CREDENTIALS_PATH);

    const classId = `${ISSUER_ID}.estudante_class_v1`;
    const cpfLimpo = estudante.cpf.replace(/\D/g, '');
    const objectId = `${ISSUER_ID}.${cpfLimpo}`;

    const genericObject = {
        id: objectId,
        classId: classId,
        state: 'ACTIVE',
        cardTitle: { defaultValue: { language: 'pt-BR', value: 'Carteira de Estudante' } },
        header: { defaultValue: { language: 'pt-BR', value: estudante.instituicao || 'Estudante' } },
        subheader: { defaultValue: { language: 'pt-BR', value: estudante.nome } },
        textModulesData: [
            { header: 'CURSO', body: estudante.curso || 'Não informado' },
            { header: 'MATRÍCULA', body: estudante.matricula || 'Não informada' },
            { header: 'CPF', body: estudante.cpf }
        ],
        barcode: { type: 'QR_CODE', value: `DNE-${cpfLimpo}`, alternateText: estudante.cpf }
    };

    const claims = {
        iss: credentials.client_email,
        aud: 'google',
        typ: 'savetowallet',
        payload: { genericObjects: [genericObject] }
    };

    const token = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
    return `https://pay.google.com/gp/v/save/${token}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});