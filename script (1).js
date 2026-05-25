// ===================================================
// 1. CONFIGURAÇÃO E CONEXÃO COM O SERVIDOR (FIREBASE)
// ===================================================
const firebaseConfig = {
  apiKey: "AIzaSyBe7jdY2y04Uw1DuQ9T6f5NXJOqPzRPPZo",
  authDomain: "alerta-bairro-8adce.firebaseapp.com",
  projectId: "alerta-bairro-8adce",
  storageBucket: "alerta-bairro-8adce.firebasestorage.app",
  messagingSenderId: "726524118429",
  appId: "1:726524118429:web:35f9dc6935efb157321b74"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth(); 

// ===================================================
// 2. VARIÁVEIS GERAIS E CONFIGURAÇÃO DO MAPA
// ===================================================
let filtroTipoAtual = "todos"; // NOVO: Variável global que gerencia o filtro ativo
let alertas = [];
let marcadores = [];
let radarAtivo = false;
let idRastreio = null;
let primeiraCargaDB = true; 
let pushHabilitadoPeloUsuario = true; 

let marcadorUsuario = null; 
let circuloRadar = null;   
let ultimaLatUsuario = null; 
let ultimaLngUsuario = null; 
let camadasRegiaoCalor = []; 

// Nível de acesso padrão inicial caso o banco demore para responder (por segurança)
let nivelAcessoUsuarioAtual = "comum"; 

const mapa = L.map('mapa', { attributionControl: false }).setView([-3.1190, -60.0217], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);

// Função auxiliar para injetar dinamicamente o formulário de alertas dependendo de QUEM está logado
function obterPopupFormularioHTML() {
  let opcoesSelect = `
    <option>Roubo</option>
    <option>Falta de Luz</option>
    <option>Alagamento</option>
    <option>Acidente de Trânsito</option>
  `;

  if (nivelAcessoUsuarioAtual === "autoridade") {
    opcoesSelect += `<option>Incêndio</option>`;
  }
  
  if (nivelAcessoUsuarioAtual === "tecnico") {
    opcoesSelect += `
      <option>Obra Municipal</option>
      <option>Manutenção Programada (Água/Luz)</option>
    `;
  }

  return `
    <div style="font-family: sans-serif; min-width:180px;">
      <h3 style="font-size:13px; margin-bottom:6px; color:#0A2540;">Novo Alerta (${nivelAcessoUsuarioAtual.toUpperCase()})</h3>
      <select id="popupTipo" style="padding:4px; font-size:11px; width:100%;">
        ${opcoesSelect}
      </select>
      <input type="text" id="popupBairro" placeholder="Bairro automático" readonly style="padding:4px; font-size:11px; margin-top:4px; width:100%;">
      <textarea id="popupDescricao" rows="2" placeholder="Descreva o incidente..." style="padding:4px; font-size:11px; margin-top:4px; width:100%;"></textarea>
      <button onclick="salvarAlertaMapa()" style="margin-top:6px; padding:6px; width:100%; background:#D9383A; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer;">Salvar Alerta</button>
    </div>`;
}

// ===================================================
// 2.1 ALGORITMO DINÂMICO DE CLUSTERING (MAPA DE CALOR)
// ===================================================
// ===================================================
// 2.1 ALGORITMO DINÂMICO DE CLUSTERING (MAPA DE CALOR)
// ===================================================
function gerarMapaDeCalorDinamico() {
  // Limpa os mapas de calor anteriores da tela
  camadasRegiaoCalor.forEach(c => mapa.removeLayer(c));
  camadasRegiaoCalor = [];

  const gruposAgrupados = [];
  const RAIO_AGRUPAMENTO_METROS = 400; 

  alertas.forEach(alerta => {
    if (!alerta.lat || !alerta.lng) return;

    // === NOVO: FILTRAGEM EM TEMPO REAL ===
    // Se o filtro atual não for "todos" e o tipo do alerta não bater com o filtro, ignora ele!
    if (filtroTipoAtual !== "todos") {
      // Normaliza os textos tirando espaços e deixando em minúsculo para evitar erros de digitação
      const tipoAlertaNormalizado = alerta.tipo.toLowerCase().trim();
      const filtroNormalizado = filtroTipoAtual.toLowerCase().trim();
      
      if (!tipoAlertaNormalizado.includes(filtroNormalizado)) {
        return; // Pula este alerta e não coloca ele no mapa de calor
      }
    }

    let grupoEncontrado = null;

    for (let grupo of gruposAgrupados) {
      const pontoGrupo = L.latLng(grupo.lat, grupo.lng);
      const pontoAlerta = L.latLng(alerta.lat, alerta.lng);
      if (pontoGrupo.distanceTo(pontoAlerta) <= RAIO_AGRUPAMENTO_METROS) {
        grupoEncontrado = grupo;
        break;
      }
    }

    if (grupoEncontrado) {
      grupoEncontrado.total++;
      grupoEncontrado.bairro = alerta.bairro || grupoEncontrado.bairro;
      grupoEncontrado.tipos[alerta.tipo] = (grupoEncontrado.tipos[alerta.tipo] || 0) + 1;
    } else {
      gruposAgrupados.push({
        lat: alerta.lat,
        lng: alerta.lng,
        bairro: alerta.bairro || "Zona Monitorada",
        total: 1,
        tipos: { [alerta.tipo]: 1 }
      });
    }
  });

  gruposAgrupados.forEach(grupo => {
    let corCalor = '#adff2f'; 
    if (grupo.total >= 6) corCalor = '#f44336'; 
    else if (grupo.total >= 4) corCalor = '#ff9800'; 
    else if (grupo.total >= 3) corCalor = '#ffeb3b'; 

    let stringTipos = "";
    for (const tipo in grupo.tipos) {
      stringTipos += `<br>• ${tipo}: ${grupo.tipos[tipo]}`;
    }

    const popupEstatistica = `
      <div style="font-family: sans-serif; font-size: 12px; color: #212529; min-width: 160px;">
        <strong style="font-size:13px; color:#D9383A;">📊 Área Crítica: ${grupo.bairro}</strong><br>
        <strong>Total de Ocorrências: ${grupo.total}</strong>
        <hr style="margin: 6px 0; border:0; border-top:1px solid #dee2e6;">
        ${stringTipos}
      </div>
    `;

    // Criando a mancha apenas se o grupo possuir alertas ativos após o filtro
    const manchaRegiao = L.circle([grupo.lat, grupo.lng], {
      color: corCalor,
      fillColor: corCalor,
      fillOpacity: 0.18, 
      weight: 1.5,
      radius: 600 
    }).addTo(mapa).bindPopup(popupEstatistica);

    camadasRegiaoCalor.push(manchaRegiao);
  });
}

// ===================================================
// 3. RECUPERAÇÃO REALTIME DO CLOUD FIRESTORE E PUSH
// ===================================================
db.collection("alertas").orderBy("data", "desc").onSnapshot((querySnapshot) => {
  let novosAlertas = [];
  querySnapshot.forEach((doc) => {
    novosAlertas.push(doc.data());
  });

  if (!primeiraCargaDB && radarAtivo && pushHabilitadoPeloUsuario && novosAlertas.length > alertas.length) {
    const maisRecente = novosAlertas[0]; 
    verificarEDispararPushNotificacao(maisRecente);
  }

  alertas = novosAlertas;
  primeiraCargaDB = false;
  
  // Roda o controle visual unificado respeitando filtros ativos
  atualizarInterfaceVisívelComFiltro();
});

function verificarEDispararPushNotificacao(alerta) {
  if (!ultimaLatUsuario || !ultimaLngUsuario || !alerta.lat || !alerta.lng) return;
  const pontoUsuario = L.latLng(ultimaLatUsuario, ultimaLngUsuario);
  const pontoAlerta = L.latLng(alerta.lat, alerta.lng);
  if (pontoUsuario.distanceTo(pontoAlerta) <= 500) {
    if (Notification.permission === "granted") {
      new Notification("🚨 Alerta de Proximidade!", {
        body: `Foi emitido um alerta de "${alerta.tipo}" no bairro ${alerta.bairro}.`,
        icon: "https://cdn-icons-png.flaticon.com/512/564/564619.png"
      });
    }
  }
}

// NOVO: Função isolada de renderização que cruza os dados com os botões selecionados
function atualizarInterfaceVisívelComFiltro() {
  // 1. Filtra os dados na memória baseado na variável global
  const alertasFiltrados = alertas.filter(alerta => {
    if (filtroTipoAtual === "todos") return true;
    const tipoLower = alerta.tipo.toLowerCase();
    if (filtroTipoAtual === "roubo") return tipoLower.includes('roubo') || tipoLower.includes('assalto');
    if (filtroTipoAtual === "luz") return tipoLower.includes('luz') || tipoLower.includes('energia');
    if (filtroTipoAtual === "alagamento") return tipoLower.includes('alagamento') || tipoLower.includes('cheia');
    return true;
  });

  // 2. Renderiza a lista lateral com dados filtrados
  const lista = document.getElementById('listaAlertas');
  if (lista) {
    if (alertasFiltrados.length === 0) {
      lista.innerHTML = '<p style="color:#8e9194; font-size:12px; text-align:center; margin-top:20px;">Sem atividades deste tipo.</p>';
    } else {
      lista.innerHTML = '';
      alertasFiltrados.forEach(alerta => {
        let cssClass = '';
        if(alerta.tipo.includes('Roubo')) cssClass = 'alerta-roubo';
        else if(alerta.tipo.includes('Luz')) cssClass = 'alerta-falta-luz';
        else if(alerta.tipo.includes('Alagamento')) cssClass = 'alerta-alagamento';
        else if(alerta.tipo.includes('Trânsito')) cssClass = 'alerta-transito';
        else if(alerta.tipo.includes('Incêndio')) cssClass = 'alerta-incendio';
        else if(alerta.tipo.includes('Obra') || alerta.tipo.includes('Manutenção')) cssClass = 'alerta-obra';

        lista.innerHTML += `
        <div class="alerta-card ${cssClass}">
          <div class="alerta-header">
            <span>🚨 ${alerta.tipo}</span>
            <span class="alerta-bairro">📍 ${alerta.bairro}</span>
          </div>
          <div class="alerta-corpo">${alerta.descricao}</div>
        </div>`;
      });
    }
  }

  // 3. Renderiza os marcadores do mapa com dados filtrados
  marcadores.forEach(m => mapa.removeLayer(m));
  marcadores = [];
  alertasFiltrados.forEach(alerta => {
    if(alerta.lat && alerta.lng){
      const marcador = L.marker([alerta.lat, alerta.lng], { tipoAlerta: alerta.tipo }).addTo(mapa);
      marcador.bindPopup(`<strong>🚨 ${alerta.tipo}</strong><br>${alerta.descricao}`);
      marcadores.push(marcador);
    }
  });

  // 4. Gera mapas de calor e carrosséis estruturais
  gerarMapaDeCalorDinamico(); 
  renderizarCarrosselComunitario(); 
}

// NOVO: Função chamada pelos botões de clique no HTML do topo do mapa
function filtrarAlertasPorTipo(tipo, botaoClicado) {
  filtroTipoAtual = tipo;

  // Atualiza classe CSS ativa nos botões
  const botoes = document.querySelectorAll('.btn-filtro');
  botoes.forEach(b => {
    b.classList.remove('ativo');
    b.style.background = "#f8fafc";
    b.style.color = "#0f172a";
  });
  
  botaoClicado.classList.add('ativo');
  botaoClicado.style.background = "#0A2540";
  botaoClicado.style.color = "#ffffff";

  // Reaplica a filtragem visual imediatamente
  atualizarInterfaceVisívelComFiltro();
}

// ===================================================
// 4. AUTENTICAÇÃO E CONTROLE DE NÍVEIS DE ACESSO
// ===================================================
function verificarNivelDeAcessoServidor(user) {
  if (!user) return;
  db.collection("usuarios").doc(user.uid).get().then((doc) => {
    if (doc.exists && doc.data().nivelAcesso) {
      nivelAcessoUsuarioAtual = doc.data().nivelAcesso;
    } else {
      nivelAcessoUsuarioAtual = "comum";
      db.collection("usuarios").doc(user.uid).set({
        email: user.email,
        nivelAcesso: "comum"
      }, { merge: true });
    }
    console.log("Nível de acesso definido operacionalmente como:", nivelAcessoUsuarioAtual);
  }).catch((error) => {
    console.error("Erro ao verificar privilégios:", error);
    nivelAcessoUsuarioAtual = "comum";
  });
}

function criarConta() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return alert('Preencha os campos obrigatórios.');
  auth.createUserWithEmailAndPassword(email, senha).then((cred) => {
    db.collection("usuarios").doc(cred.user.uid).set({
      email: email,
      nivelAcesso: "comum"
    }).then(() => {
      loginExitosa();
    });
  }).catch(err => alert(err.message));
}

// Declarações vazias das funções complementares para evitar erros de compilação indefinida
function recuperarSenha() { alert("Recuperação de senha enviada para o e-mail."); }
function abrirSubmenuNotificacoes() { document.getElementById('menuPainelPrincipal').style.display='none'; document.getElementById('submenuNotificacoes').style.display='block'; }
function fecharSubmenuNotificacoes() { document.getElementById('menuPainelPrincipal').style.display='block'; document.getElementById('submenuNotificacoes').style.display='none'; }
function alternarPreferenciaPush() { pushHabilitadoPeloUsuario = document.getElementById('switchPushNotificacao').checked; }

function login() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return alert('Preencha os campos obrigatórios.');
  auth.signInWithEmailAndPassword(email, senha).then(() => {
    loginExitosa();
  }).catch(err => alert("Usuário ou senha incorretos."));
}

function loginComGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).then((cred) => {
    db.collection("usuarios").doc(cred.user.uid).get().then(doc => {
      if(!doc.exists) {
        db.collection("usuarios").doc(cred.user.uid).set({
          email: cred.user.email,
          nivelAcesso: "comum"
        });
      }
      loginExitosa();
    });
  });
}

function loginExitosa() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('sistema').style.display = 'block';
  document.body.classList.remove('tela-autenticacao'); 
  
  const usuarioAtual = auth.currentUser;
  if (usuarioAtual) {
    atualizarDadosPerfilTela(usuarioAtual);
    verificarNivelDeAcessoServidor(usuarioAtual);
  }
  gerenciarFluxoDeEntrada();
}

function gerenciarFluxoDeEntrada() {
  if (!localStorage.getItem('alertaBairroJaAcessou')) {
    localStorage.setItem('alertaBairroJaAcessou', 'true');
    mostrarPagina('inicio');
  } else {
    mostrarPagina('mapaPagina');
  }
}

function sair() {
  document.getElementById('menuFlutuantePerfil').style.display = 'none';
  auth.signOut().then(() => {
    document.getElementById('loginPage').style.display = 'block';
    document.getElementById('sistema').style.display = 'none';
    document.getElementById('figjamTools').style.display = 'none';
    document.getElementById('email').value = '';
    document.getElementById('senha').value = '';
    document.body.classList.add('tela-autenticacao'); 
    nivelAcessoUsuarioAtual = "comum";

    const containerCarrosseis = document.querySelector('.container-carrosseis');
    if (containerCarrosseis) containerCarrosseis.style.display = 'none';
    if (radarAtivo) navigator.geolocation.clearWatch(idRastreio);
  });
}

function mostrarOcultarSenhaLogin() {
  const campoSenha = document.getElementById('senha');
  campoSenha.type = campoSenha.type === 'password' ? 'text' : 'password';
}

function atualizarDadosPerfilTela(user) {
  if (user) {
    document.getElementById('perfilNome').innerText = user.displayName || "Usuário Comunitário";
    document.getElementById('perfilEmail').innerText = user.email || "sem-email@provedor.com";
    const fotoElemento = document.getElementById('perfilFoto');
    fotoElemento.src = user.photoURL || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239aa0a6'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  }
}

function toggleMenuPerfil(event) {
  event.stopPropagation(); 
  const menu = document.getElementById('menuFlutuantePerfil');
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

document.addEventListener('click', function(e) {
  const menu = document.getElementById('menuFlutuantePerfil');
  if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
    menu.style.display = 'none';
  }
});

// ===================================================
// 5. SONAR / GEOLOCALIZAÇÃO ATIVA
// ===================================================
function iniciarRadar() {
  // 1. Verificação de segurança simplificada
  const user = auth.currentUser;
  if (!user) {
    abrirModalLogin();
    return;
  }

  // 2. Lógica do Radar
  if (!radarAtivo) {
    radarAtivo = true;
    document.getElementById('btnRadar').innerText = "Desligar Sonar";
    document.getElementById('textoRadar').innerText = "Radar Ativo";
    
    // Inicia o rastreio (garantindo que o círculo seja criado)
    iniciarRastreio(); 
  } else {
    radarAtivo = false;
    document.getElementById('btnRadar').innerText = "Ligar Sonar";
    document.getElementById('textoRadar').innerText = "Radar Desligado";
    
    // Remove o radar do mapa
    if (circuloRadar) {
      mapa.removeLayer(circuloRadar);
      circuloRadar = null;
    }
  }
}

function atualizarLocalizacaoERadar(posicao) {
  ultimaLatUsuario = posicao.coords.latitude;
  ultimaLngUsuario = posicao.coords.longitude;
  const pontoUsuario = L.latLng(ultimaLatUsuario, ultimaLngUsuario);
  
  if (!marcadorUsuario) {
    marcadorUsuario = L.marker([ultimaLatUsuario, ultimaLngUsuario]).addTo(mapa).bindPopup("📍").openPopup();
    circuloRadar = L.circle([ultimaLatUsuario, ultimaLngUsuario], {
      color: '#4285F4', fillColor: '#4285F4', fillOpacity: 0.1, radius: 500 
    }).addTo(mapa);
    document.getElementById('btnCentralizar').disabled = false;
    mapa.flyTo([ultimaLatUsuario, ultimaLngUsuario], 15);
  } else {
    marcadorUsuario.setLatLng([ultimaLatUsuario, ultimaLngUsuario]);
    circuloRadar.setLatLng([ultimaLatUsuario, ultimaLngUsuario]);
  }
  
  let perigoProximo = null;
  let menorDistancia = 500; 

  alertas.forEach(alerta => {
    if (alerta.lat && alerta.lng) {
      const pontoAlerta = L.latLng(alerta.lat, alerta.lng);
      const distancia = pontoUsuario.distanceTo(pontoAlerta); 
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        perigoProximo = alerta;
      }
    }
  });

  const divStatus = document.getElementById('statusRadar');
  const txtRadar = document.getElementById('textoRadar');
  const txtDetalhe = document.getElementById('detalheRadar');

  if (perigoProximo) {
    divStatus.style.background = "#f8d7da"; 
    txtRadar.style.color = "#721c24";
    txtRadar.innerText = "🚨 Incidente Próximo";
    txtDetalhe.innerText = `Evento tipo "${perigoProximo.tipo}" a ${Math.round(menorDistancia)}m.`;
  } else {
    divStatus.style.background = "#d4edda"; 
    txtRadar.style.color = "#155724";
    txtRadar.innerText = "✅ Perímetro Seguro";
    txtDetalhe.innerText = "Nenhuma atividade suspeita nos últimos 500m.";
  }
}

function erroLocalizacao() {
  document.getElementById('textoRadar').innerText = "Aviso de GPS";
  document.getElementById('detalheRadar').innerText = "Permissão negada ou sinal fraco.";
}

function centrarEmMim() {
  if (ultimaLatUsuario && ultimaLngUsuario) {
    const latLng = [ultimaLatUsuario, ultimaLngUsuario];

    // O flyTo é mais suave e não trava o mapa
    mapa.flyTo(latLng, 16, {
      animate: true,
      duration: 0.5
    });
  } else {
    alert("Aguardando sinal de GPS...");
  }
}

// ===================================================
// 6. NAVEGAÇÃO E VIEWS (FEED LATERAL)
// ===================================================
function mostrarPagina(id){
  const paginas = document.querySelectorAll('.pagina');
  paginas.forEach(pagina => { pagina.classList.remove('ativa'); });
  
  document.getElementById(id).classList.add('ativa');
  
  const barraFigjam = document.getElementById('figjamTools');
  const containerCarrosseis = document.querySelector('.container-carrosseis');
  
  if(id === 'mapaPagina') {
    if(barraFigjam) barraFigjam.style.display = 'flex';
    
    if (containerCarrosseis) {
        containerCarrosseis.style.display = 'none'; // Use display none direto
    }
    
    setTimeout(() => { 
      mapa.invalidateSize(); 
      gerarMapaDeCalorDinamico(); 
    }, 200);
  } else {
    if(barraFigjam) barraFigjam.style.display = 'none';
    if (containerCarrosseis) {
      containerCarrosseis.style.setProperty('display', 'flex', 'important');
    }
  }
}

// === CORREÇÃO DO CLIQUE NO MAPA ===
let latClick = null, lngClick = null;

// Configuração do clique no mapa para gerar alertas
mapa.on('click', function(e) {
  // TRAVA PARA O MAPA
  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }
  
  // Se estiver logado, segue o baile:
  abrirPopupCriacaoAlerta(e.latlng.lat, e.latlng.lng);
});

function salvarAlertaMapa(){
  const tipo = document.getElementById('popupTipo').value;
  const bairro = document.getElementById('popupBairro').value;
  const descricao = document.getElementById('popupDescricao').value;

  if(!bairro || !descricao) return alert('Preencha os dados.');

  const novoAlerta = {
    tipo: tipo, 
    bairro: bairro, 
    descricao: descricao,
    lat: latClick || mapa.getCenter().lat, 
    lng: lngClick || mapa.getCenter().lng,
    data: firebase.firestore.FieldValue.serverTimestamp()
  };

  db.collection("alertas").add(novoAlerta).then(() => {
    mapa.closePopup();
    latClick = null; lngClick = null; 
  });
}

async function detectarBairro(lat, lng){
  try{
    const resposta = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const dados = await resposta.json();
    const inputBairro = document.getElementById('popupBairro');
    if(inputBairro) {
      inputBairro.value = dados.address.suburb || dados.address.neighbourhood || "Manaus";
    }
  }catch{
    const inputBairro = document.getElementById('popupBairro');
    if(inputBairro) inputBairro.value = "Manaus";
  }
}

// === ESCUTADOR DE AUTENTICAÇÃO DINÂMICO (BOAS-VINDAS VS MAPA) ===
auth.onAuthStateChanged((user) => {
  const containerCarrosseis = document.querySelector('.container-carrosseis');
  const btnLogin = document.getElementById('btnNavLogin');
  const btnPerfil = document.getElementById('btnNavPerfil');
  
  if (user) {
    // 1. USUÁRIO LOGADO -> Carrega os dados e joga direto para o Quadro Branco (Mapa)
    loginExitosa();
    mostrarPagina('mapaPagina');
    if (containerCarrosseis) containerCarrosseis.style.display = 'flex';
  } else {
    // 2. USUÁRIO NÃO LOGADO -> Mostra botão de Entrar e força a tela de Boas-vindas
    if (btnLogin) btnLogin.style.display = 'block';
    if (btnPerfil) btnPerfil.style.display = 'none';
    
    mostrarPagina('inicio');
    
    // Deixa o container de carrosséis visível para o público ver as ocorrências recentes
    if (containerCarrosseis) containerCarrosseis.style.display = 'flex';
  }
});
function scrollCarrossel(idElemento, direcao) {
  const carrossel = document.getElementById(idElemento);
  if (carrossel) {
    const quantidadeScroll = 300; 
    carrossel.scrollBy({ left: quantidadeScroll * direcao, behavior: 'smooth' });
  }
}

function renderizarCarrosselComunitario() {
  const container = document.getElementById('carrosselComunitario');
  if (!container) return;
  
  container.innerHTML = ''; 

  if (alertas.length === 0) {
    container.innerHTML = `
      <div class="card-vazio">
        <p>Nenhum alerta comunitário registrado recentemente.</p>
      </div>`;
    return;
  }

  alertas.forEach(alerta => {
    container.innerHTML += `
      <div class="card-carrossel-item" style="min-width: 200px; padding: 10px; background: #fff; border-radius: 8px; margin-right: 10px; border: 1px solid #e2e8f0;">
        <strong>🚨 ${alerta.tipo}</strong>
        <p style="font-size: 11px; color: #64748b; margin-top: 4px;">${alerta.descricao}</p>
        <span style="font-size: 10px; color: #94a3b8; display: block; margin-top: 6px;">📍 ${alerta.bairro}</span>
      </div>`;
  });
}
// ===================================================
// NÚCLEO DE CONTROLE DO MODAL (POP-UP) DE LOGIN
// ===================================================
function abrirModalLogin() {
  const modal = document.getElementById('loginPage');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function fecharModalLogin() {
  const modal = document.getElementById('loginPage');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Substitua ou atualize a sua função loginExitosa existente por esta:
function loginExitosa() {
  fecharModalLogin();
  
  const painelSistema = document.getElementById('sistema');
  if (painelSistema) painelSistema.style.display = 'block';
  
  document.body.classList.remove('tela-autenticacao'); 
  
  // Troca os botões do cabeçalho de forma cirúrgica
  const btnLogin = document.getElementById('btnNavLogin');
  const btnPerfil = document.getElementById('btnNavPerfil');
  
  if (btnLogin) btnLogin.style.display = 'none';
  if (btnPerfil) btnPerfil.style.display = 'block';
  
  const usuarioAtual = auth.currentUser;
  if (usuarioAtual) {
    atualizarDadosPerfilTela(usuarioAtual);
    verificarNivelDeAcessoServidor(usuarioAtual);
  }
}
// ===================================================
// NÚCLEO DE RASTREIO E SONAR
// ===================================================
function iniciarRastreio() {
  if (navigator.geolocation) {
    idRastreio = navigator.geolocation.watchPosition((position) => {
      const { latitude, longitude } = position.coords;
      
      // 1. ATUALIZA VARIÁVEIS GLOBAIS
      ultimaLatUsuario = latitude;
      ultimaLngUsuario = longitude;

      // 2. HABILITA BOTÃO
      const btnCentralizar = document.getElementById('btnCentralizar');
      if (btnCentralizar) {
        btnCentralizar.disabled = false;
        btnCentralizar.style.opacity = "1";
        btnCentralizar.style.cursor = "pointer";
      }

      // 3. ATUALIZA PING NO MAPA
      if (marcadorUsuario) {
        marcadorUsuario.setLatLng([latitude, longitude]);
      } else {
        marcadorUsuario = L.circleMarker([latitude, longitude], {
          color: '#ffffff',
          fillColor: '#4285F4',
          fillOpacity: 1,
          radius: 8,
          weight: 2
        }).addTo(mapa).bindPopup("Você está aqui!");
      }

      // 4. ATUALIZA CÍRCULO DO RADAR E ALERTAS (Se ativo)
      if (radarAtivo) {
        if (circuloRadar) mapa.removeLayer(circuloRadar);
        circuloRadar = L.circle([latitude, longitude], {
          radius: 500,
          color: '#4285F4',
          fillColor: '#4285F4',
          fillOpacity: 0.2
        }).addTo(mapa);

        // --- AQUI ENTRA A NOVA FUNCIONALIDADE ---
        verificarAlertasProximos();
      }
      
    }, (error) => {
      console.error("Erro na localização:", error);
    }, { enableHighAccuracy: true });
  }
}

// Sobrescrita da função iniciarRadar para garantir que ela chame o rastreio corretamente
const funcaoRadarOriginal = iniciarRadar;
iniciarRadar = function() {
  // Verifica login (trava de segurança)
  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }

  // Lógica de alternância (Ligar/Desligar)
  if (!radarAtivo) {
    radarAtivo = true;
    document.getElementById('btnRadar').innerText = "Desligar Sonar";
    document.getElementById('textoRadar').innerText = "Radar Ativo";
    iniciarRastreio(); // <--- CHAMA A FUNÇÃO DE DESENHO AQUI
  } else {
    radarAtivo = false;
    document.getElementById('btnRadar').innerText = "Ligar Sonar";
    document.getElementById('textoRadar').innerText = "Radar Desligado";
    
    // Para e remove o radar
    if (idRastreio) {
      navigator.geolocation.clearWatch(idRastreio);
      idRastreio = null;
    }
    if (circuloRadar) {
      mapa.removeLayer(circuloRadar);
      circuloRadar = null;
    }
  }
};
// Força o clique no botão a não ser capturado pelo mapa
document.getElementById('btnCentralizar').addEventListener('mousedown', function(e) {
  e.stopPropagation();
});
function verificarAlertasProximos() {
    const container = document.getElementById('containerAlertasProximidade');
    if (!container) return; 
    container.innerHTML = ''; 

    mapa.eachLayer((layer) => {
        // Verifica se é um marcador e se tem o 'tipoAlerta'
        if (layer instanceof L.Marker && layer.options.tipoAlerta) {
            const dist = mapa.distance([ultimaLatUsuario, ultimaLngUsuario], layer.getLatLng());
            if (dist <= 500) {
                const div = document.createElement('div');
                div.style.color = "#d9534f";
                div.style.fontWeight = "bold";
                div.innerHTML = `⚠️ ${layer.options.tipoAlerta} a ${Math.round(dist)}m`;
                container.appendChild(div);
            }
        }
    });
}