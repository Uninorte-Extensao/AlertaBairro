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
let filtroTipoAtual = "todos"; 
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

let latClick = null, lngClick = null; 
let nivelAcessoUsuarioAtual = "comum"; 
let ultimoPopup = null; 

const mapa = L.map('mapa', { attributionControl: false }).setView([-3.1190, -60.0217], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);

// ===================================================
// CONFIGURAÇÃO DO FORMULÁRIO DO MAPA
// ===================================================
function obterPopupFormularioHTML() {
  // CORREÇÃO: Nome da variável padronizado para "opcoesSelect"
  let opcoesSelect = `
    <option>Roubo</option>
    <option>Falta de Luz</option>
    <option>Alagamento</option>
    <option>Acidente de Trânsito</option>
    <option>Desaparecimento</option>
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
      <input type="text" id="popupBairro" placeholder="Buscando bairro..." readonly style="padding:4px; font-size:11px; margin-top:4px; width:100%;">
      <textarea id="popupDescricao" rows="2" placeholder="Descreva o incidente..." style="padding:4px; font-size:11px; margin-top:4px; width:100%;"></textarea>
      <button onclick="salvarAlertaMapa()" style="margin-top:6px; padding:6px; width:100%; background:#D9383A; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer;">Salvar Alerta</button>
    </div>`;
}

// ===================================================
// OUVINTE DE CLIQUE NO MAPA (CORRIGIDO E SIMPLIFICADO)
// ===================================================
// Substitua o mapa.on('click') antigo por este:
// ===================================================
// OUVINTE DE CLIQUE NO MAPA (CORRIGIDO E SEGURO)
// ===================================================
mapa.on('click', function(e) {
  // 1. Se o usuário NÃO estiver logado, ele NÃO pode criar alertas
  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }

  // 2. Se o usuário clicou no botão "Selecionar no Mapa" (Modo Uber)
  if (typeof selecionandoLocalManualmente !== 'undefined' && selecionandoLocalManualmente === true) {
    ultimaLatUsuario = e.latlng.lat;
    ultimaLngUsuario = e.latlng.lng;
    selecionandoLocalManualmente = false; // Desativa o modo seleção para o próximo clique ser normal
    
    // Reabre o modal expandido trazendo a localização nova
    abrirModalAlertaExpandido();
    return;
  }

  // 3. Clique Normal: Abre o popup pequeno padrão do mapa
  abrirPopupCriacaoAlerta(e.latlng.lat, e.latlng.lng);
});

function abrirPopupCriacaoAlerta(lat, lng) {
  latClick = lat;
  lngClick = lng;

  // Se já houver um popup aberto, fecha antes de abrir o novo
  if (ultimoPopup) {
    mapa.closePopup(ultimoPopup);
  }

  // Abre a janelinha exatamente nas coordenadas do clique
  ultimoPopup = L.popup({ closeOnClick: false })
    .setLatLng([lat, lng])
    .setContent(obterPopupFormularioHTML())
    .openOn(mapa);

  detectarBairro(lat, lng);
}

// ===================================================
// FUNÇÕES DE EXIBIÇÃO E TOAST
// ===================================================
function showToast(msg, type = 'success', ttl = 2800) {
  const cont = document.getElementById('toastContainer');
  if (!cont) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'success' ? 'success' : '');
  t.innerText = msg;
  cont.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toast-out 240ms ease forwards';
    t.addEventListener('animationend', () => { try{ cont.removeChild(t); }catch(e){} });
  }, ttl);
}

function irParaAlerta(lat, lng) {
  if (!lat || !lng) return;
  mapa.flyTo([lat, lng], 16, { animate: true, duration: 0.8 });

  marcadores.forEach(marcador => {
    const coords = marcador.getLatLng();
    if (coords.lat === lat && coords.lng === lng) {
      marcador.openPopup();
    }
  });
}

// ===================================================
// 2.1 MAPA DE CALOR (CLUSTERING DE ÁREAS CRÍTICAS)
// ===================================================
// ===================================================
// 2.1 MAPA DE CALOR (CLUSTERING DE ÁREAS CRÍTICAS)
// ===================================================
function gerarMapaDeCalorDinamico() {
  camadasRegiaoCalor.forEach(c => mapa.removeLayer(c));
  camadasRegiaoCalor = [];

  const gruposAgrupados = [];
  const RAIO_AGRUPAMENTO_METROS = 400; 

  alertas.forEach(alerta => {
    if (!alerta.lat || !alerta.lng) return;

    if (filtroTipoAtual !== "todos") {
      const tipoAlertaNormalizado = alerta.tipo.toLowerCase().trim();
      const filtroNormalizado = filtroTipoAtual.toLowerCase().trim();
      if (!tipoAlertaNormalizado.includes(filtroNormalizado)) return;
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
        <strong>Total: ${grupo.total}</strong><hr style="margin:6px 0; border:0; border-top:1px solid #dee2e6;">
        ${stringTipos}
      </div>
    `;

    // 1. CÍRCULO GIGANTE: Agora ele tem "interactive: false". 
    // Isso faz os cliques "atravessarem" ele e chegarem na rua do mapa!
    const manchaRegiao = L.circle([grupo.lat, grupo.lng], {
      color: corCalor, 
      fillColor: corCalor, 
      fillOpacity: 0.18, 
      weight: 1.5, 
      radius: 600,
      interactive: false // <-- A mágica que permite você criar o alerta
    }).addTo(mapa);

    // 2. ÍCONE DE ESTATÍSTICA: Coloca o 📊 no centro do raio só para segurar as estatísticas
    const iconeGrafico = L.divIcon({
        className: 'icone-estatistica',
        html: `<div style="font-size: 22px; text-shadow: 0px 0px 4px white; cursor: pointer;">📊</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    const marcadorEstatistica = L.marker([grupo.lat, grupo.lng], { icon: iconeGrafico })
        .addTo(mapa)
        .bindPopup(popupEstatistica);

    // Salva os dois na memória para limpar quando a tela atualizar
    camadasRegiaoCalor.push(manchaRegiao);
    camadasRegiaoCalor.push(marcadorEstatistica);
  });
}

// ===================================================
// 3. RECUPERAÇÃO REALTIME E FILTRAGENS VISUAIS
// ===================================================
function verificarEDispararPushNotificacao(alerta) {
  console.log("Notificação detectada:", alerta);
}

db.collection("alertas").orderBy("data", "desc").onSnapshot((querySnapshot) => {
  let novosAlertas = [];
  querySnapshot.forEach((doc) => { 
    novosAlertas.push(doc.data()); 
  });

  if (!primeiraCargaDB && radarAtivo && pushHabilitadoPeloUsuario && novosAlertas.length > alertas.length) {
    verificarEDispararPushNotificacao(novosAlertas[0]);
  }

  alertas = novosAlertas;
  primeiraCargaDB = false;
  atualizarInterfaceVisívelComFiltro();
});

function atualizarInterfaceVisívelComFiltro() {
  const alertasFiltrados = alertas.filter(alerta => {
    if (filtroTipoAtual === "todos") return true;
    const tipoLower = alerta.tipo.toLowerCase();
    if (filtroTipoAtual === "roubo") return tipoLower.includes('roubo') || tipoLower.includes('assalto');
    if (filtroTipoAtual === "luz") return tipoLower.includes('luz') || tipoLower.includes('energia');
    if (filtroTipoAtual === "alagamento") return tipoLower.includes('alagamento') || tipoLower.includes('cheia');
    return true;
  });

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
else if(alerta.tipo.includes('Desaparecimento')) cssClass = 'alerta-desaparecimento'; // <-- ADICIONE ESTA LINHA

        // ASSIM ESTÁ NO SEU CÓDIGO ORIGINAL:
// COLOQUE ESTE BLOCO CORRIGIDO NO LUGAR:
// Se o alerta tem uma URL da nuvem, usa ela. Se não tiver mas disser que tem anexo, tenta usar o nome, senão usa o padrão colorido
let urlImagem = alerta.urlAnexo || (alerta.nomeAnexo ? alerta.nomeAnexo : 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150');

let htmlImagemDireita = '';
// Forçamos a exibição caso exista o link direto (urlAnexo) ou o marcador antigo (contemAnexo)
if (alerta.contemAnexo || alerta.urlAnexo) {
  // Onde você monta o HTML, troque para isso:
htmlImagemDireita = `
  <div class="coluna-imagem-alerta">
    <img src="${urlImagem}" 
         class="foto-registro-lateral" 
         onclick="abrirFoto('${urlImagem}')" 
         alt="Evidência" 
         style="cursor: pointer;">
  </div>
`;
}

        lista.innerHTML += `
        <div class="alerta-card ${cssClass} ${alerta.contemAnexo ? 'com-foto' : ''}" onclick="irParaAlerta(${alerta.lat}, ${alerta.lng})" style="cursor: pointer;">
          <div class="coluna-texto-alerta">
            <div class="alerta-header">
              <span>🚨 ${alerta.tipo}</span>
              <span class="alerta-bairro">📍 ${alerta.bairro}</span>
            </div>
            <div class="alerta-corpo">${alerta.descricao}</div>
          </div>
          ${htmlImagemDireita}
        </div>`;
      });
    }
  }

  marcadores.forEach(m => mapa.removeLayer(m));
  marcadores = [];
  
  alertasFiltrados.forEach(alerta => {
    if(alerta.lat && alerta.lng){
      const marcador = L.marker([alerta.lat, alerta.lng], { tipoAlerta: alerta.tipo }).addTo(mapa);
      marcador.bindPopup(`<strong>🚨 ${alerta.tipo}</strong><br>${alerta.descricao}`);
      marcador.on('click', function(e) { L.DomEvent.stopPropagation(e); });
      marcadores.push(marcador);
    }
  });

  gerarMapaDeCalorDinamico(); 
  renderizarCarrosselComunitario(); 
}

function filtrarAlertasPorTipo(tipo, botaoClicado) {
  filtroTipoAtual = tipo;
  const botoes = document.querySelectorAll('.btn-filtro');
  botoes.forEach(b => {
    b.classList.remove('ativo'); b.style.background = "#f8fafc"; b.style.color = "#0f172a";
  });
  botaoClicado.classList.add('ativo');
  botaoClicado.style.background = "#0A2540";
  botaoClicado.style.color = "#ffffff";
  atualizarInterfaceVisívelComFiltro();
}

// ===================================================
// 4. SISTEMA DE AUTENTICAÇÃO E PERFIL
// ===================================================
function login() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return alert('Preencha os campos.');
  auth.signInWithEmailAndPassword(email, senha).then(() => { loginExitosa(); }).catch(() => alert("Dados incorretos."));
}

function loginComGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).then((cred) => {
    db.collection("usuarios").doc(cred.user.uid).get().then(doc => {
      if(!doc.exists) db.collection("usuarios").doc(cred.user.uid).set({ email: cred.user.email, nivelAcesso: "comum" });
      loginExitosa();
    });
  });
}

function loginExitosa() {
  fecharModalLogin();
  
  // Exibe a estrutura do sistema principal
  const sistema = document.getElementById('sistema');
  if (sistema) sistema.style.display = 'block';
  
  document.body.classList.remove('tela-autenticacao'); 
  
  // Altera os botões de Login / Perfil na barra de navegação
  const btnLogin = document.getElementById('btnNavLogin');
  const btnPerfil = document.getElementById('btnNavPerfil');
  if (btnLogin) btnLogin.style.display = 'none';
  if (btnPerfil) btnPerfil.style.display = 'block';
  
  const user = auth.currentUser;
  if (user) { 
    atualizarDadosPerfilTela(user); 
  }
}

function sair() {
  // Fecha o menu de perfil se estiver aberto
  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';
  
  // Limpa o radar se estiver ativo antes de deslogar
  if (radarAtivo && idRastreio) {
    navigator.geolocation.clearWatch(idRastreio);
    idRastreio = null;
  }
  if (circuloRadar) {
    mapa.removeLayer(circuloRadar);
    circuloRadar = null;
  }

  // Faz o logout no Firebase
  auth.signOut().catch(err => console.error("Erro ao deslogar:", err));
}

function criarConta() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return alert('Campos vazios.');
  auth.createUserWithEmailAndPassword(email, senha).then(() => { loginExitosa(); }).catch(err => alert(err.message));
}

function recuperarSenha() { alert("Recuperação enviada."); }
function abrirSubmenuNotificacoes() { document.getElementById('menuPainelPrincipal').style.display='none'; document.getElementById('submenuNotificacoes').style.display='block'; }
function fecharSubmenuNotificacoes() { document.getElementById('menuPainelPrincipal').style.display='block'; document.getElementById('submenuNotificacoes').style.display='none'; }
function alternarPreferenciaPush() { pushHabilitadoPeloUsuario = document.getElementById('switchPushNotificacao').checked; }
function mostrarOcultarSenhaLogin() { const s = document.getElementById('senha'); s.type = s.type === 'password' ? 'text' : 'password'; }

function abrirModalLogin() { 
  const m = document.getElementById('loginPage'); 
  if (!m) return;
  m.style.display = 'flex';
  requestAnimationFrame(() => m.classList.add('open'));
}

function fecharModalLogin() { 
  const m = document.getElementById('loginPage'); 
  if (!m) return;
  m.classList.remove('open');
  const remover = () => { m.style.display = 'none'; m.removeEventListener('transitionend', remover); };
  m.addEventListener('transitionend', remover);
}
function toggleMenuPerfil(e) { e.stopPropagation(); const m = document.getElementById('menuFlutuantePerfil'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; }
function gerenciarFluxoDeEntrada() { if (!localStorage.getItem('alertaBairroJaAcessou')) { localStorage.setItem('alertaBairroJaAcessou', 'true'); mostrarPagina('inicio'); } else { mostrarPagina('mapaPagina'); } }

function atualizarDadosPerfilTela(user) {
  if (user) {
    document.getElementById('perfilNome').innerText = user.displayName || "Usuário Comunitário";
    document.getElementById('perfilEmail').innerText = user.email || "sem-email@provedor.com";
    document.getElementById('perfilFoto').src = user.photoURL || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239aa0a6'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  }
}

// Adicione isso ao seu script.js para fechar ao clicar na imagem ampliada
document.addEventListener('click', (e) => {
  const ampliada = document.querySelector('.foto-registro-lateral.ampliada');
  if (ampliada && !e.target.classList.contains('ampliada')) {
    ampliada.classList.remove('ampliada');
  }
});

// ===================================================
// 5. SONAR / GEOLOCALIZAÇÃO ATIVA
// ===================================================
function iniciarRadar() {
  if (!auth.currentUser) { abrirModalLogin(); return; }
  if (!radarAtivo) {
    radarAtivo = true; document.getElementById('btnRadar').innerText = "Desligar Sonar"; document.getElementById('textoRadar').innerText = "Radar Ativo";
    iniciarRastreio(); 
  } else {
    radarAtivo = false; document.getElementById('btnRadar').innerText = "Ligar Sonar"; document.getElementById('textoRadar').innerText = "Radar Desligado";
    if (idRastreio) { navigator.geolocation.clearWatch(idRastreio); idRastreio = null; }
    if (circuloRadar) { mapa.removeLayer(circuloRadar); circuloRadar = null; }
  }
}

function iniciarRastreio() {
  if (navigator.geolocation) {
    idRastreio = navigator.geolocation.watchPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      ultimaLatUsuario = latitude; ultimaLngUsuario = longitude;

      const btn = document.getElementById('btnCentralizar');
      if (btn) { btn.disabled = false; btn.style.opacity = "1"; }

      if (marcadorUsuario) { marcadorUsuario.setLatLng([latitude, longitude]); } 
      else {
        marcadorUsuario = L.circleMarker([latitude, longitude], { color: '#ffffff', fillColor: '#4285F4', fillOpacity: 1, radius: 8, weight: 2 }).addTo(mapa).bindPopup("Você está aqui!");
      }

      if (radarAtivo) {
        // CORRIGIDO: Agora usando latitude e longitude reais do rastreio
        if (circuloRadar) {
          circuloRadar.setLatLng([latitude, longitude]);
          circuloRadar.setRadius(500);
        } else {
          circuloRadar = L.circle([latitude, longitude], {
            radius: 500,
            color: '#0284c7',       // Borda Azul Escuro do Radar
            fillColor: '#38bdf8',   // Preenchimento Azul Claro
            fillOpacity: 0.15,
            weight: 2
          }).addTo(mapa);
        }
        verificarAlertasProximos();
      }
    }, null, { enableHighAccuracy: true });
  }
}

function calcularNivelPerigo() {
    let totalAlertas = 0;
    let alertasProximos = []; 

    mapa.eachLayer((layer) => {
        if (layer instanceof L.Marker && layer.options.tipoAlerta) {
            const dist = mapa.distance([ultimaLatUsuario, ultimaLngUsuario], layer.getLatLng());
            if (dist <= 500) {
                totalAlertas++;
                alertasProximos.push({ tipo: layer.options.tipoAlerta, dist: dist });
            }
        }
    });

    let nivelPerigo = 0; 
    let alertasCriticos = alertasProximos.filter(a => a.dist <= 250).length; 
    let alertasProximidade = alertasProximos.filter(a => a.dist > 250 && a.dist <= 400).length; 
    let alertasDistancia = alertasProximos.filter(a => a.dist > 400).length; 

    // NOVO: Forçamos nível de perigo se houver qualquer Roubo no perímetro
    const temRouboPerto = alertasProximos.some(a => a.tipo.toLowerCase().includes('roubo'));

    if (alertasCriticos >= 3 || totalAlertas >= 8 || temRouboPerto) {
        nivelPerigo = 2; // Força o estado crítico (Caixa Vermelha) se houver roubo próximo!
    } else if (alertasCriticos >= 2 || (alertasProximos.length >= 5 && alertasProximos.some(a => a.dist <= 250)) || totalAlertas >= 5) {
        nivelPerigo = 1; 
    } else if (totalAlertas > 0) {
        nivelPerigo = 0; 
    }

    return { nivelPerigo, totalAlertas, alertasProximos, alertasCriticos, alertasProximidade };
}

function verificarAlertasProximos() {
    const container = document.getElementById('containerAlertasProximidade');
    if (!container) return; container.innerHTML = '';

    const { nivelPerigo, totalAlertas, alertasProximos, alertasCriticos } = calcularNivelPerigo();

    // Customização dinâmica das cores de segurança do perímetro
    // SUBSTITUA APENAS O DICIONÁRIO "CORES" DENTRO DE verificarAlertasProximos():
    const cores = {
        0: { radarColor: '#22c55e', radarFill: '#86efac', statusBg: '#dcfce7', statusText: '#166534', emoji: '✅', titulo: 'Perímetro Seguro', detalhe: 'Nenhuma ou poucas atividades suspeitas próximas.' },
        1: { radarColor: '#eab308', radarFill: '#fef08a', statusBg: '#fef3c7', statusText: '#a16207', emoji: '⚠️', titulo: 'Ameaça Detectada', detalhe: `${totalAlertas} alerta(s) próximo(s)` },
        2: { radarColor: '#ef4444', radarFill: '#fca5a5', statusBg: '#fee2e2', statusText: '#7f1d1d', emoji: '⚠️', titulo: 'Perímetro em Alerta', detalhe: 'Atenção! Foram detectadas atividades suspeitas ou crimes recentes a menos de 500m.' }
    };

    const corConfig = cores[nivelPerigo];

    if (circuloRadar) {
        // Mantém o círculo azul do radar para não poluir visualmente o mapa, mudando só a pulsação
        const radarElement = circuloRadar._path;
        if (radarElement) {
            if (nivelPerigo === 2) {
                radarElement.classList.add('radar-critico-pulse');
            } else if (nivelPerigo === 1) {
                radarElement.classList.add('radar-aviso-pulse');
            } else {
                radarElement.classList.remove('radar-critico-pulse', 'radar-aviso-pulse');
            }
        }
    }

    // Buscando as tags do seu HTML dinamicamente (por ID ou classe do painel)
    const txtRadar = document.getElementById('textoRadar') || document.querySelector('.radar-status-box');
    const txtDet = document.getElementById('detalheRadar') || document.querySelector('.radar-descricao');
    const divS = document.getElementById('statusRadar') || document.querySelector('.radar-status-box');

    if (divS) {
        divS.style.background = corConfig.statusBg;
        divS.style.color = corConfig.statusText;
        divS.style.borderColor = corConfig.radarColor;
        
        // Se for a caixa principal, mudamos o HTML interno dela
        if(divS.classList.contains('radar-status-box') || divS.id === 'statusRadar') {
          divS.innerHTML = corConfig.titulo;
        }
    }
    
    if (txtRadar && txtRadar !== divS) {
        txtRadar.style.color = corConfig.statusText;
        txtRadar.innerText = corConfig.titulo;
    }
    if (txtDet) {
        txtDet.innerText = corConfig.detalhe;
        txtDet.style.color = corConfig.statusText;
    }

    alertasProximos.slice(0, 3).forEach(alerta => {
        const iconEmoji = alerta.dist < 250 ? '🔴' : '🟡';
        container.innerHTML += `<div style="color: #7f1d1d; font-weight: bold; margin-top: 6px; font-size: 11px;">${iconEmoji} ${alerta.tipo} - ${Math.round(alerta.dist)}m</div>`;
    });

    if (totalAlertas > 3) {
        container.innerHTML += `<div style="color: #7f1d1d; font-size: 10px; margin-top: 6px; font-style: italic;">+${totalAlertas - 3} alerta(s) mais</div>`;
    }
}

function centrarEmMim() {
  if (ultimaLatUsuario && ultimaLngUsuario) mapa.flyTo([ultimaLatUsuario, ultimaLngUsuario], 16);
}

// ===================================================
// 6. NAVEGAÇÃO E SALVAMENTO DE ALERTAS
// ===================================================
function mostrarPagina(id){
  const paginas = document.querySelectorAll('.pagina');
  
  // Remove a classe ativa de todas as telas (efeito de saída instantâneo)
  paginas.forEach(p => p.classList.remove('ativa'));
  
  // Adiciona a classe na tela certa (dispara a animação sutil de entrada)
  const alvo = document.getElementById(id);
  if (alvo) {
    alvo.classList.add('ativa');
  }
  
  // Mantém os ajustes originais do mapa e carrosséis do seu projeto
  const containerCarrosseis = document.querySelector('.container-carrosseis');
  if(id === 'mapaPagina') {
    if (containerCarrosseis) containerCarrosseis.style.display = 'none'; 
    setTimeout(() => { mapa.invalidateSize(); gerarMapaDeCalorDinamico(); }, 200);
  } else {
    if (containerCarrosseis) containerCarrosseis.style.setProperty('display', 'flex', 'important');
  }
}

function salvarAlertaMapa(){
  const tipo = document.getElementById('popupTipo').value;
  const bairro = document.getElementById('popupBairro').value;
  const descricao = document.getElementById('popupDescricao').value;
  if(!bairro || !descricao) return alert('Preencha os dados.');

  const novo = {
    tipo, bairro, descricao,
    lat: latClick || mapa.getCenter().lat, 
    lng: lngClick || mapa.getCenter().lng,
    data: firebase.firestore.FieldValue.serverTimestamp()
  };
  
  db.collection("alertas").add(novo).then(() => {
    if (ultimoPopup) mapa.closePopup(ultimoPopup);
    else mapa.closePopup();
    showToast('Alerta publicado com sucesso!', 'success');
  });
}

async function detectarBairro(lat, lng){
  try{
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const d = await res.json();
    const input = document.getElementById('popupBairro');
    if(input) input.value = d.address.suburb || d.address.neighbourhood || d.address.city_district || "Manaus";
  }catch{
    const input = document.getElementById('popupBairro'); if(input) input.value = "Manaus";
  }
}

auth.onAuthStateChanged((user) => {
  const loginPage = document.getElementById('loginPage');
  const sistema = document.getElementById('sistema');

  if (user) { 
    // ==========================================
    // USUÁRIO CADASTRADO / LOGADO -> DIRETO PRO MAPA
    // ==========================================
    loginExitosa(); 
    mostrarPagina('mapaPagina'); 
  } else { 
    // ==========================================
    // USUÁRIO NÃO LOGADO / SAIU -> BOAS-VINDAS
    // ==========================================
    // Esconde os dados de perfil da navbar se houver
    const btnLogin = document.getElementById('btnNavLogin');
    const btnPerfil = document.getElementById('btnNavPerfil');
    if (btnLogin) btnLogin.style.display = 'block';
    if (btnPerfil) btnPerfil.style.display = 'none';
    
    // Garante que o modal de login não fique travado aberto no meio da tela
    if (loginPage) loginPage.style.display = 'none';
    
    // Redireciona de forma limpa para a tela de início (boas-vindas)
    mostrarPagina('inicio'); 
  }
});

function scrollCarrossel(id, dir) {
  const c = document.getElementById(id);
  if (c) c.scrollBy({ left: 300 * dir, behavior: 'smooth' });
}

function renderizarCarrosselComunitario() {
  const container = document.getElementById('carrosselComunitario');
  if (!container) return; container.innerHTML = ''; 
  if (alertas.length === 0) {
    container.innerHTML = `<div class="card-vazio"><p>Nenhum alerta registrado.</p></div>`; return;
  }
  alertas.forEach(a => {
    container.innerHTML += `
      <div class="card-carrossel-item" onclick="irParaAlerta(${a.lat}, ${a.lng})" style="min-width:200px; padding:10px; background:#fff; border-radius:8px; margin-right:10px; border:1px solid #e2e8f0; cursor:pointer;">
        <strong>🚨 ${a.tipo}</strong><p style="font-size:11px; color:#64748b; margin-top:4px;">${a.descricao}</p><small style="color:#94a3b8;">📍 ${a.bairro}</small>
      </div>`;
  });
}

const btnCen = document.getElementById('btnCentralizar');
if (btnCen) btnCen.addEventListener('mousedown', (e) => e.stopPropagation());

// ===================================================
// 7. MÓDULO DO NOVO MODAL EXPANDIDO DE CRIAR ALERTA
// ===================================================
function gatilhoBotaoAlertaExpandido() {
  if (!auth.currentUser) { abrirModalLogin(); return; }
  abrirModalAlertaExpandido();
}

function abrirModalAlertaExpandido() {
  const m = document.getElementById('modalAlertaExpandido'); if (!m) return;
  
  setTimeout(() => {
    const tipoSelect = document.getElementById('modalExpTipo');
    if (tipoSelect) {
      if (![...tipoSelect.options].some(o => o.value === 'Desaparecimento')) {
        const opt = document.createElement('option');
        opt.value = 'Desaparecimento';
        opt.innerHTML = 'Desaparecimento';
        tipoSelect.appendChild(opt);
      }
      tipoSelect.addEventListener('change', gerenciarExibicaoCampoImagem);
    }
    gerenciarExibicaoCampoImagem();
  }, 100);

  if (ultimaLatUsuario && ultimaLngUsuario) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${ultimaLatUsuario}&lon=${ultimaLngUsuario}`)
      .then(res => res.json()).then(d => {
        const b = d.address.suburb || d.address.neighbourhood || d.address.city_district || "";
        if (document.getElementById('modalExpBairro')) document.getElementById('modalExpBairro').value = b;
      });
  }
  m.style.display = 'flex';
  requestAnimationFrame(() => m.classList.add('open'));
}

function fecharModalAlertaExpandido() {
  const m = document.getElementById('modalAlertaExpandido'); if (!m) return; 
  m.classList.remove('open');
  const remover = () => { m.style.display = 'none'; m.removeEventListener('transitionend', remover); };
  m.addEventListener('transitionend', remover);
  if(document.getElementById('modalExpBairro')) document.getElementById('modalExpBairro').value = '';
  if(document.getElementById('modalExpDescricao')) document.getElementById('modalExpDescricao').value = '';
  if(document.getElementById('modalExpArquivo')) document.getElementById('modalExpArquivo').value = '';
  if(document.getElementById('nomeArquivoTexto')) document.getElementById('nomeArquivoTexto').innerText = 'Nenhum arquivo selecionado';
  const prev = document.getElementById('modalExpPreview'); if (prev) { prev.src = ''; prev.style.display = 'none'; }
}

function mostrarPreviewArquivoModal(e) {
  const input = e.target || document.getElementById('modalExpArquivo');
  const nomeTxt = document.getElementById('nomeArquivoTexto');
  const preview = document.getElementById('modalExpPreview');
  if (!input || !input.files || input.files.length === 0) {
    if (nomeTxt) nomeTxt.innerText = 'Nenhum arquivo selecionado';
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    return;
  }
  const file = input.files[0];
  if (nomeTxt) nomeTxt.innerText = file.name;
  if (file.type && file.type.startsWith('image/') && preview) {
    const reader = new FileReader();
    reader.onload = function(ev) {
      preview.src = ev.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
  }
}

function salvarAlertaModalExpandido() {
  const tipo = document.getElementById('modalExpTipo').value;
  const bairro = document.getElementById('modalExpBairro').value;
  const descricao = document.getElementById('modalExpDescricao').value;
  const arq = document.getElementById('modalExpArquivo');

  if (!bairro || !descricao) return alert('Por favor, preencha todos os campos obrigatórios.');
  
  let lat = ultimaLatUsuario || mapa.getCenter().lat;
  let lng = ultimaLngUsuario || mapa.getCenter().lng;

  function salvarNoFirestore(urlDaFoto) {
    db.collection("alertas").add({
      tipo, 
      bairro, 
      descricao, 
      lat, 
      lng,
      data: firebase.firestore.FieldValue.serverTimestamp(),
      contemAnexo: urlDaFoto ? true : false,
      urlAnexo: urlDaFoto || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150',
      aprovado: false
    }).then(() => { 
      fecharModalAlertaExpandido(); 
      showToast('Alerta publicado com sucesso!', 'success'); 
    }).catch((error) => {
      console.error("Erro ao salvar:", error);
      alert("Ocorreu um erro ao salvar o alerta.");
    });
  }

  if (arq && arq.files.length > 0) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const fotoEmTexto = e.target.result;
      salvarNoFirestore(fotoEmTexto);
    };
    reader.readAsDataURL(arq.files[0]);
  } else {
    salvarNoFirestore(null);
  }
}

function gerenciarExibicaoCampoImagem() {
  const tipoSelect = document.getElementById('modalExpTipo');
  const blocoEvidencia = document.getElementById('blocoEvidencia');
  const campoArquivo = document.getElementById('modalExpArquivo');
  const previewImagem = document.getElementById('modalExpPreview');
  const textoArquivo = document.getElementById('nomeArquivoTexto');
  
  if (tipoSelect && blocoEvidencia) {
    if (tipoSelect.value === 'Desaparecimento') {
      blocoEvidencia.style.display = 'block';
    } else {
      blocoEvidencia.style.display = 'none';
      if (campoArquivo) campoArquivo.value = ''; 
      if (previewImagem) previewImagem.style.display = 'none';
      if (textoArquivo) textoArquivo.textContent = 'Nenhum arquivo selecionado';
    }
  }
}

let selecionandoLocalManualmente = false;

function iniciarSelecaoManualMapa() {
  selecionandoLocalManualmente = true;
  fecharModalAlertaExpandido(); 
  showToast('Toque no mapa para escolher o local do alerta', 'info', 4000);
}

function fecharFoto() {
  document.querySelector('.foto-registro-lateral.ampliada')?.classList.remove('ampliada');
  document.querySelector('.overlay-ampliado').style.display = 'none';
}
function abrirFoto(url) {
  const modal = document.getElementById('modal-imagem-global');
  const imgConteudo = document.getElementById('imagem-ampliada-conteudo');
  
  imgConteudo.src = url; // Define a imagem que foi clicada
  modal.style.display = 'flex'; // Mostra o modal na tela
}