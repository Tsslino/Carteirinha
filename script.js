let fotoDataUrl = "";
const RENDER_URL = 'https://dne-backend.onrender.com';
const instList = ["USP - Universidade de São Paulo", "UFSC - Universidade Federal de Santa Catarina", "UFRJ - Univ. Federal do Rio de Janeiro", "UNICAMP", "UNESP", "PUC - Pontifícia Univ. Católica", "Estácio de Sá", "Anhanguera Educacional", "FGV - Fundação Getulio Vargas", "IFSC - Inst. Federal de Santa Catarina"];

let nsfwModel = null;

// Carrega o modelo de IA em segundo plano assim que a página abre
nsfwjs.load().then(model => {
    nsfwModel = model;
    console.log("Modelo de análise de imagem carregado!");
});

function irParaFormulario() {
    document.getElementById('landing-container').style.display = 'none';
    document.getElementById('form-section').style.display = 'flex';
    document.getElementById('preview-section').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarLanding() {
    document.getElementById('landing-container').style.display = 'block';
    document.getElementById('form-section').style.display = 'none';
    document.getElementById('preview-section').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function proximoPasso(step) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active-step'));
    document.getElementById(`step-${step}`).classList.add('active-step');
    document.getElementById('current-step-num').innerText = step;

    const progress = (step - 1) * 50;
    document.getElementById('progress-line').style.width = `${progress}%`;

    for(let i = 1; i <= 3; i++) {
        const ind = document.getElementById(`ind-${i}`);
        if(i < step) { 
            ind.className = 'step-indicator completed'; 
            ind.innerText = '✓'; 
        } else if(i === step) { 
            ind.className = 'step-indicator active'; 
            ind.innerText = i; 
        } else { 
            ind.className = 'step-indicator'; 
            ind.innerText = i; 
        }
    }
}

function testaCPF(strCPF) {
    strCPF = strCPF.replace(/[^\d]+/g,'');
    if (strCPF.length !== 11 || /^(\d)\1+$/.test(strCPF)) return false;
    let soma = 0, resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(strCPF.substring(i-1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(strCPF.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(strCPF.substring(i-1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(strCPF.substring(10, 11));
}

function mascaraCPF(input) {
    let v = input.value.replace(/\D/g, "");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    input.value = v;

    const valid = (v.length === 14 && testaCPF(v));
    document.getElementById('cpf-ok').style.display = valid ? 'block' : 'none';
    validarEtapa1();
}

function validarEtapa1() {
    const nome = document.getElementById('input-nome').value;
    const cpf = document.getElementById('input-cpf').value;
    const nasc = document.getElementById('input-nasc').value;
    const validCpf = (cpf.length === 14 && testaCPF(cpf));
    
    document.getElementById('btn-next-1').disabled = !(nome.length >= 5 && validCpf && nasc);
}

function autocompleteInst(input) {
    const listDiv = document.getElementById('autocomplete-list');
    listDiv.innerHTML = '';
    const val = input.value.toLowerCase();
    if (!val) return;

    instList.filter(item => item.toLowerCase().includes(val)).forEach(match => {
        const itemDiv = document.createElement('div');
        itemDiv.innerText = match;
        itemDiv.onclick = () => { 
            input.value = match; 
            listDiv.innerHTML = ''; 
        };
        listDiv.appendChild(itemDiv);
    });
}

// Filtro de desfoque
function isImageBlurry(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imgElement.width;
    canvas.height = imgElement.height;
    ctx.drawImage(imgElement, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let rSum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        rSum += (data[i] + data[i+1] + data[i+2]) / 3;
    }
    const mean = rSum / (data.length / 4);

    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i+1] + data[i+2]) / 3;
        variance += Math.pow(avg - mean, 2);
    }
    variance = variance / (data.length / 4);

    return variance < 300; 
}

// Analisa e comprime a imagem
async function previewImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('file-label-text').innerText = `⏳ A analisar qualidade da foto...`;
    document.getElementById('btn-submit').disabled = true;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = async function() {
            
            // 1. Verificação de Desfoque
            if (isImageBlurry(img)) {
                alert("⚠️ A foto parece estar muito desfocada ou escura. Por favor, envie uma foto com melhor iluminação e nitidez.");
                document.getElementById('file-label-text').innerText = `📸 Tente outra foto`;
                return;
            }

            // 2. Verificação de Conteúdo Explícito (IA)
            if (nsfwModel) {
                const predictions = await nsfwModel.classify(img);
                const isExplicit = predictions.some(p => 
                    (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.6
                );

                if (isExplicit) {
                    alert("🚫 A foto foi rejeitada pelos nossos filtros de segurança. Envie uma foto de rosto em formato 3x4 padrão.");
                    document.getElementById('file-label-text').innerText = `📸 Enviar nova foto`;
                    return;
                }
            }

            // 3. Compressão da imagem
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 400;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            fotoDataUrl = canvas.toDataURL('image/jpeg', 0.7); 
            
            const preview = document.getElementById('photo-preview-img');
            preview.src = fotoDataUrl;
            preview.style.display = 'block';
            document.getElementById('file-label-text').innerText = `✅ Foto Aprovada e Carregada!`;
            validarEtapa3();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function validarEtapa3() {
    const termos = document.getElementById('termos').checked;
    document.getElementById('btn-submit').disabled = !(fotoDataUrl && termos);
}

async function iniciarPagamentoPix(event) {
    event.preventDefault();
    
    // VERIFICAÇÃO EXTRA: Impedir envio se a foto não estiver validada
    if (!fotoDataUrl) {
        alert("Aguarde a validação da foto ou envie uma foto válida.");
        return;
    }

    const nome = document.getElementById('input-nome').value;
    const cpf = document.getElementById('input-cpf').value;
    
    document.getElementById('pix-modal').style.display = 'flex';
    const statusText = document.getElementById('status-text-ia');
    
    if(statusText) statusText.innerText = "🤖 A guardar o seu registo na base de dados...";
    
    // GUARDA OS DADOS PRIMEIRO
    const salvoComSucesso = await salvarCarteirinhaPagamento();
    if (!salvoComSucesso) {
        alert('Erro ao guardar os seus dados. Verifique a sua conexão e tente novamente.');
        document.getElementById('pix-modal').style.display = 'none';
        return;
    }

    if(statusText) statusText.innerText = "🤖 A gerar o Pix no Mercado Pago...";

    try {
        const response = await fetch('/api/pagamento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: nome, cpf: cpf })
        });

        const data = await response.json();

        if (data.qr_code) {
            document.getElementById('pix-qrcode-img').src = `data:image/jpeg;base64,${data.qr_code_base64}`;
            document.getElementById('pix-copia-cola').value = data.qr_code;
            if(statusText) statusText.innerText = "🤖 Pix gerado! A aguardar o pagamento...";

            verificarStatusPagamento(data.id, cpf);
        } else {
            alert(data.error || 'Erro ao gerar o Pix.');
            document.getElementById('pix-modal').style.display = 'none';
        }
    } catch (error) {
        console.error(error);
        alert('Erro de conexão com o servidor de pagamentos.');
        document.getElementById('pix-modal').style.display = 'none';
    }
}

async function salvarCarteirinhaPagamento() {
    const dadosAluno = {
        nome: document.getElementById('input-nome').value,
        cpf: document.getElementById('input-cpf').value,
        email: document.getElementById('input-email').value,
        senha: document.getElementById('input-senha').value,
        nascimento: document.getElementById('input-nasc').value,
        instituicao: document.getElementById('input-inst').value,
        curso: document.getElementById('input-curso').value,
        nivel: document.getElementById('input-nivel').value,
        matricula: document.getElementById('input-matricula').value,
        foto: fotoDataUrl,
        status_pagamento: 'pendente'
    };

    try {
        const res = await fetch('/api/pagamento?action=salvar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dadosAluno)
        });
        return res.ok;
    } catch (e) {
        console.error("Erro ao registar dados:", e);
        return false;
    }
}

function verificarStatusPagamento(paymentId, cpfOriginal) {
    const intervalo = setInterval(async () => {
        try {
            const cpfLimpo = cpfOriginal.replace(/\D/g, '');
            const res = await fetch(`/api/pagamento?action=verificar&id=${paymentId}&cpf=${cpfLimpo}`);
            const data = await res.json();

            if (data.status === 'approved') {
                clearInterval(intervalo);
                document.getElementById('pix-modal').style.display = 'none';
                gerarCarteirinhaFinal();
            }
        } catch (e) {
            console.error("Erro ao verificar pagamento", e);
        }
    }, 4000);
}

function copiarPix() {
    const input = document.getElementById('pix-copia-cola');
    input.select();
    navigator.clipboard.writeText(input.value);
    alert('Código Pix copiado!');
}

function gerarCarteirinhaFinal() {
    const nome = document.getElementById('input-nome').value;
    const cpf = document.getElementById('input-cpf').value;
    const nascimento = document.getElementById('input-nasc').value;
    const inst = document.getElementById('input-inst').value;
    const curso = document.getElementById('input-curso').value;
    const nivel = document.getElementById('input-nivel').value;
    const matricula = document.getElementById('input-matricula').value;

    document.getElementById('card-nome').innerText = nome.toUpperCase();
    document.getElementById('card-cpf').innerText = cpf;
    document.getElementById('card-nasc').innerText = nascimento;
    document.getElementById('card-inst').innerText = inst.toUpperCase();
    document.getElementById('card-curso-resumo').innerText = `${curso} (${nivel})`;
    document.getElementById('card-matricula').innerText = matricula;
    document.getElementById('card-validade').innerText = `31/03/${new Date().getFullYear() + 1}`;

    if(fotoDataUrl) {
        document.getElementById('card-img').src = fotoDataUrl;
    }

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=DNE-VALIDADO-${cpf}`;
    document.getElementById('card-qrcode').src = qrUrl;

    document.getElementById('form-section').style.display = 'none';
    document.getElementById('preview-section').style.display = 'flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    iniciarProtecaoAntiPrint();
}

function salvarGoogleWallet() {
    const cpfTexto = document.getElementById('card-cpf').innerText;
    const cpf = cpfTexto.replace(/\D/g, ''); 
    if (!cpf) {
        alert('CPF não identificado.');
        return;
    }
    window.location.href = `${RENDER_URL}/api/carteira?action=google&cpf=${cpf}`;
}

function baixarImagemCarteirinha() {
    const element = document.getElementById('pdf-content-area');
    html2canvas(element, { scale: 3, useCORS: true }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Carteirinha_DNE_${document.getElementById('card-nome').innerText}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

function gerarPDF() {
    const element = document.getElementById('pdf-content-area');
    const opt = {
        margin:       10,
        filename:     `Carteirinha_DNE_${document.getElementById('card-nome').innerText}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
}

function iniciarProtecaoAntiPrint() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'PrintScreen' || (e.ctrlKey && (e.key === 'p' || e.key === 's' || e.key === 'u'))) {
            e.preventDefault();
            alert('⚠️ Por razões de segurança contra fraudes, capturas de tela não são recomendadas. Use os botões oficiais de Download.');
        }
    });

    document.addEventListener('visibilitychange', () => {
        const card = document.getElementById('card-to-protect');
        if (document.hidden) {
            card.style.filter = 'blur(20px)';
        } else {
            card.style.filter = 'none';
        }
    });
}