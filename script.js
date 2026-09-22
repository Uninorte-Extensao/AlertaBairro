// ===================================================
// 1. CONFIGURAÇÃO FIREBASE
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
// 2. VARIÁVEIS GERAIS E MAPA
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
let perfilAnonimoAtual = false;

// Inicialização do mapa Leaflet
const mapa = L.map('mapa', { attributionControl: false, zoomControl: false }).setView([-3.1190, -60.0217], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);

// Função formatadora de datas e horários dos alertas
function formatarDataHora(dataFirestore) {
  if (!dataFirestore) return "Agora";
  let date;
  if (dataFirestore.toDate) {
    date = dataFirestore.toDate();
  } else if (dataFirestore instanceof Date) {
    date = dataFirestore;
  } else if (typeof dataFirestore === 'number' || typeof dataFirestore === 'string') {
    date = new Date(dataFirestore);
  } else {
    return "Agora";
  }

  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const horas = String(date.getHours()).padStart(2, '0');
  const minutos = String(date.getMinutes()).padStart(2, '0');

  return `${dia}/${mes} às ${horas}:${minutos}`;
}

// ATUALIZAÇÃO REFINADA DO ESTILO DO MAPA
function atualizarEstiloMapaPorHorario() {
  const mapaEl = document.getElementById('mapa');
  if (!mapaEl) return;

  const temaSalvo = localStorage.getItem('temaAlertaBairro');
  
  if (temaSalvo === 'escuro') {
    mapaEl.classList.add('mapa-noite');
    return;
  }
  
  if (temaSalvo === 'claro') {
    mapaEl.classList.remove('mapa-noite');
    return;
  }

  // Se o utilizador não escolheu explicitamente, calcula o horário local
  const horaLocalUsuario = new Date().getHours();
  const ehNoite = horaLocalUsuario < 6 || horaLocalUsuario >= 18;

  if (ehNoite) {
    mapaEl.classList.add('mapa-noite');
  } else {
    mapaEl.classList.remove('mapa-noite');
  }
}

atualizarEstiloMapaPorHorario();
setInterval(atualizarEstiloMapaPorHorario, 15 * 60 * 1000);

// ===================================================
// FORMULÁRIO DO MAPA (NOVO ALERTA)
// ===================================================
function obterPopupFormularioHTML() {
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
    <div class="popup-novo-alerta-card">
      <div class="popup-na-cabecalho">
        <span>🚨 Novo Alerta (${nivelAcessoUsuarioAtual.toUpperCase()})</span>
        <button onclick="mapa.closePopup()" class="btn-fechar-popup-na">×</button>
      </div>
      <div class="popup-na-campo">
        <label>Tipo de Ocorrência</label>
        <select id="popupTipo" class="input-popup-na">
          ${opcoesSelect}
        </select>
      </div>
      <div class="popup-na-campo">
        <label>Bairro / Localização</label>
        <input type="text" id="popupBairro" class="input-popup-na" placeholder="Buscando bairro..." readonly autocomplete="off">
      </div>
      <div class="popup-na-campo">
        <label>Nível de Perigo</label>
        <select id="popupUrgencia" class="input-popup-na seletor-urgencia-na">
          <option value="BAIXA">🟢 Perigo baixo</option>
          <option value="MEDIA" selected>🟡 Perigo médio</option>
          <option value="ALTA">🟠 Perigo alto</option>
          <option value="CRITICA">🔴 Emergência crítica</option>
        </select>
      </div>
      <div class="popup-na-campo">
        <label>Descrição do Ocorrido</label>
        <textarea id="popupDescricao" class="input-popup-na" rows="2" placeholder="Descreva o incidente..." autocomplete="off"></textarea>
      </div>
      <button onclick="salvarAlertaMapa()" class="btn-salvar-alerta-na">Salvar Alerta</button>
    </div>`;
}

mapa.on('click', function(e) {
  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';

  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }

  abrirPopupCriacaoAlerta(e.latlng.lat, e.latlng.lng);
});

function abrirPopupCriacaoAlerta(lat, lng) {
  latClick = lat;
  lngClick = lng;

  if (ultimoPopup) {
    mapa.closePopup(ultimoPopup);
  }

  ultimoPopup = L.popup({ closeOnClick: false, className: 'leaflet-popup-novo-alerta' })
    .setLatLng([lat, lng])
    .setContent(obterPopupFormularioHTML())
    .openOn(mapa);

  detectarBairro(lat, lng);
}

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

function escaparHTML(valor) {
  return String(valor ?? '').replace(/[&<>'"]/g, caractere => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[caractere]));
}

function obterIconeAlerta(severidade) {
  const configuracoes = {
    CRITICA: { cor: '#b91c1c', icone: '🚨' },
    ALTA: { cor: '#dc2626', icone: '⚠️' },
    MEDIA: { cor: '#d97706', icone: '⚠️' },
    BAIXA: { cor: '#15803d', icone: '✅' }
  };
  const configuracao = configuracoes[severidade] || configuracoes.MEDIA;

  return L.divIcon({
    className: 'marcador-alerta-severidade',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:2px solid white;border-radius:50%;background:${configuracao.cor};box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:16px;">${configuracao.icone}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  });
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

function gerarHTMLPopupAlerta(alerta) {
  const ehAnonimo = alerta.anonimo === true;
  const autorNome = ehAnonimo ? 'Utilizador Anónimo' : (alerta.autorPublico || 'Utilizador da Comunidade');
  const fallbackFoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  const autorFoto = ehAnonimo ? fallbackFoto : (alerta.autorFoto || fallbackFoto);
  
  const verificado = alerta.autorVerificado === true;
  const badgeVerificacao = verificado
    ? `<span class="badge-verificado positivo" title="Conta 100% Verificada pelo Sistema">🟢 Verificado</span>`
    : `<span class="badge-verificado pendente" title="Ainda não possui verificação completa">⚪ Não verificado</span>`;

  const severidade = alerta.severidade || 'MEDIA';

  return `
    <div class="popup-alerta-card">
      <div class="popup-alerta-header">
        <div class="popup-autor-info">
          <img src="${escaparHTML(autorFoto)}" class="popup-autor-avatar" alt="Foto">
          <div class="popup-autor-detalhes">
            <strong>${escaparHTML(autorNome)}</strong>
            ${badgeVerificacao}
          </div>
        </div>
        <span class="popup-tag-prioridade ${severidade}">${severidade}</span>
      </div>
      <div class="popup-alerta-corpo">
        <div class="popup-alerta-tipo">🚨 ${escaparHTML(alerta.tipo)}</div>
        <p class="popup-alerta-desc">${escaparHTML(alerta.descricao)}</p>
        <small class="popup-alerta-bairro">📍 ${escaparHTML(alerta.bairro)} • ${formatarDataHora(alerta.data)}</small>
      </div>
    </div>
  `;
}

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
      stringTipos += `<div style="font-size:11.5px; margin-top:2px;">• <strong>${tipo}</strong>: ${grupo.tipos[tipo]}</div>`;
    }

    const popupEstatistica = `
      <div class="popup-area-critica-card">
        <div class="popup-ac-topo">
          <span style="font-size:20px;">📊</span>
          <div>
            <h4>Área Crítica: ${escaparHTML(grupo.bairro)}</h4>
            <small>${grupo.total} ocorrência(s) registrada(s)</small>
          </div>
        </div>
        <hr style="border:0; border-top:1px solid #1E293B; margin:6px 0;">
        ${stringTipos}
      </div>
    `;

    const manchaRegiao = L.circle([grupo.lat, grupo.lng], {
      color: corCalor, 
      fillColor: corCalor, 
      fillOpacity: 0.18, 
      weight: 1.5, 
      radius: 600,
      interactive: false
    }).addTo(mapa);

    const iconeGrafico = L.divIcon({
        className: 'icone-estatistica-badge',
        html: `<div class="badge-area-critica-pill">📊 ${grupo.total} alertas</div>`,
        iconSize: [80, 26],
        iconAnchor: [-12, 32]
    });

    const marcadorEstatistica = L.marker([grupo.lat, grupo.lng], { icon: iconeGrafico })
        .addTo(mapa)
        .bindPopup(popupEstatistica);

    camadasRegiaoCalor.push(manchaRegiao);
    camadasRegiaoCalor.push(marcadorEstatistica);
  });
}

// ===================================================
// 3. RECUPERAÇÃO REALTIME E RENDERING DOS CARDS
// ===================================================
db.collection("alertas").orderBy("data", "desc").onSnapshot((querySnapshot) => {
  let novosAlertas = [];
  querySnapshot.forEach((doc) => { 
    novosAlertas.push(doc.data()); 
  });

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
        const tipo = escaparHTML(alerta.tipo);
        const bairro = escaparHTML(alerta.bairro);
        const descricao = escaparHTML(alerta.descricao);
        const dataHora = formatarDataHora(alerta.data);

        const ehAnonimo = alerta.anonimo === true;
        const autorNome = ehAnonimo ? 'Utilizador Anónimo' : (alerta.autorPublico || 'Utilizador da Comunidade');
        const fallbackFoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
        const autorFoto = ehAnonimo ? fallbackFoto : (alerta.autorFoto || fallbackFoto);
        const verificado = alerta.autorVerificado === true;

        let cssClass = '';
        if(alerta.tipo.includes('Roubo')) cssClass = 'alerta-roubo';
        else if(alerta.tipo.includes('Luz')) cssClass = 'alerta-falta-luz';
        else if(alerta.tipo.includes('Alagamento')) cssClass = 'alerta-alagamento';

        let cssSeveridade = 'severidade-MEDIA';
        if (alerta.severidade && ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'].includes(String(alerta.severidade).toUpperCase())) {
          cssSeveridade = `severidade-${String(alerta.severidade).toUpperCase()}`;
        }

        const urlFoto = alerta.urlAnexo || alerta.nomeAnexo;
        const temFotoReal = Boolean(
          urlFoto && 
          urlFoto.trim() !== '' && 
          !urlFoto.includes('unsplash.com') && 
          (alerta.contemAnexo === true || urlFoto.startsWith('http'))
        );

        let htmlImagemDireita = '';
        if (temFotoReal) {
          htmlImagemDireita = `
            <div class="coluna-imagem-alerta">
              <img src="${escaparHTML(urlFoto)}"
                   class="foto-registro-lateral" 
                   data-url="${escaparHTML(urlFoto)}"
                   onclick="abrirFoto(this.dataset.url)"
                   alt="Evidência" 
                   style="cursor: pointer;">
            </div>
          `;
        }

        lista.innerHTML += `
        <div class="alerta-card ${cssClass} ${cssSeveridade}" onclick="irParaAlerta(${alerta.lat}, ${alerta.lng})" style="cursor: pointer;">
          <div class="alerta-autor-row">
            <div class="alerta-autor-dados">
              <img src="${escaparHTML(autorFoto)}" class="alerta-avatar-mini" alt="Autor">
              <span class="alerta-nome-autor">${escaparHTML(autorNome)} ${verificado ? '🟢' : ''}</span>
            </div>
            <span class="alerta-data-hora">🕒 ${dataHora}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="coluna-texto-alerta">
              <div class="alerta-header">
                <span class="alerta-titulo-tipo">🚨 ${tipo}</span>
                <span class="alerta-bairro">📍 ${bairro}</span>
              </div>
              <div class="alerta-corpo">${descricao}</div>
            </div>
            ${htmlImagemDireita}
          </div>
        </div>`;
      });
    }
  }

  marcadores.forEach(m => mapa.removeLayer(m));
  marcadores = [];
  
  alertasFiltrados.forEach(alerta => {
    if(alerta.lat && alerta.lng){
      const severidade = alerta.severidade || 'MEDIA';
      const marcador = L.marker([alerta.lat, alerta.lng], {
        icon: obterIconeAlerta(severidade),
        tipoAlerta: alerta.tipo
      }).addTo(mapa);
      
      marcador.bindPopup(gerarHTMLPopupAlerta(alerta));
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
    b.classList.remove('ativo');
    b.removeAttribute('style');
  });

  botaoClicado.classList.add('ativo');
  atualizarInterfaceVisívelComFiltro();
}

// ===================================================
// 4. MODO ESCURO E ALTERNÂNCIA DE TEMA REFINADA
// ===================================================
function alternarModoEscuro(ativo) {
  const mapaEl = document.getElementById('mapa');

  if (ativo) {
    document.body.classList.add('modo-escuro');
    if (mapaEl) mapaEl.classList.add('mapa-noite');
    localStorage.setItem('temaAlertaBairro', 'escuro');
  } else {
    document.body.classList.remove('modo-escuro');
    if (mapaEl) mapaEl.classList.remove('mapa-noite');
    localStorage.setItem('temaAlertaBairro', 'claro');
  }

  if (radarAtivo) {
    verificarAlertasProximos();
  }

  const modalRadar = document.getElementById('modalHistoricoRadar');
  if (modalRadar && modalRadar.style.display === 'flex') {
    renderizarAlertasRadarArea();
  }
}

function carregarTemaSalvo() {
  const temaSalvo = localStorage.getItem('temaAlertaBairro');
  const switchEscuro = document.getElementById('switchModoEscuro');
  const mapaEl = document.getElementById('mapa');

  if (temaSalvo === 'escuro') {
    document.body.classList.add('modo-escuro');
    if (mapaEl) mapaEl.classList.add('mapa-noite');
    if (switchEscuro) switchEscuro.checked = true;
  } else if (temaSalvo === 'claro') {
    document.body.classList.remove('modo-escuro');
    if (mapaEl) mapaEl.classList.remove('mapa-noite');
    if (switchEscuro) switchEscuro.checked = false;
  } else {
    // Caso padrão inicial sem preferência guardada
    document.body.classList.remove('modo-escuro');
    if (switchEscuro) switchEscuro.checked = false;
    atualizarEstiloMapaPorHorario();
  }
}

document.addEventListener('DOMContentLoaded', carregarTemaSalvo);

// ===================================================
// 5. AUTENTICAÇÃO E PERFIL
// ===================================================
function login() {
  const emailEl = document.getElementById('email');
  const senhaEl = document.getElementById('senha');
  const email = emailEl ? emailEl.value : '';
  const senha = senhaEl ? senhaEl.value : '';

  if (!email || !senha) return alert('Preencha os campos.');

  auth.signInWithEmailAndPassword(email, senha)
    .then(() => {
      if (senhaEl) senhaEl.value = '';
      loginExitosa();
    })
    .catch(() => alert("Dados incorretos."));
}

function loginComGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).then((cred) => {
    db.collection("usuarios").doc(cred.user.uid).get().then(doc => {
      if(!doc.exists) db.collection("usuarios").doc(cred.user.uid).set({ email: cred.user.email, nivelAcesso: "comum" });
      
      const senhaEl = document.getElementById('senha');
      if (senhaEl) senhaEl.value = '';

      loginExitosa();
    });
  });
}

async function carregarDadosEPreferenciasPerfil(user) {
  if (!user) return;
  
  const fallbackFoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239aa0a6'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

  document.getElementById('perfilNome').innerText = user.displayName || "Usuário Comunitário";
  document.getElementById('perfilEmail').innerText = user.email || "sem-email@provedor.com";

  try {
    const doc = await db.collection('usuarios').doc(user.uid).get();
    
    let fotoFinal = user.photoURL || fallbackFoto;
    let nomeFinal = user.displayName || "Usuário Comunitário";

    if (doc.exists) {
      const dados = doc.data();
      perfilAnonimoAtual = dados.anonimo === true;
      
      if (dados.photoURL && dados.photoURL.trim() !== '') {
        fotoFinal = dados.photoURL;
      }
      if (dados.nome && dados.nome.trim() !== '') {
        nomeFinal = dados.nome;
      }
    }

    document.getElementById('perfilNome').innerText = nomeFinal;
    document.getElementById('perfilFoto').src = fotoFinal;
    
    const imgNav = document.getElementById('navPerfilFoto');
    if (imgNav) imgNav.src = fotoFinal;

    const imgPerfilAtual = document.getElementById('imgPerfilAtual');
    if (imgPerfilAtual) imgPerfilAtual.src = fotoFinal;

  } catch (err) {
    console.error("Erro ao carregar dados do Firestore:", err);
  }
}

function loginExitosa() {
  fecharModalLogin();
  const btnLogin = document.getElementById('btnNavLogin');
  const btnPerfil = document.getElementById('btnNavPerfil');
  if (btnLogin) btnLogin.style.display = 'none';
  if (btnPerfil) btnPerfil.style.display = 'block';
  
  const user = auth.currentUser;
  if (user) { 
    carregarDadosEPreferenciasPerfil(user);
  }
}

function sair() {
  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';
  
  if (radarAtivo && idRastreio) {
    navigator.geolocation.clearWatch(idRastreio);
    idRastreio = null;
  }
  if (circuloRadar) {
    mapa.removeLayer(circuloRadar);
    circuloRadar = null;
  }

  auth.signOut().catch(err => console.error("Erro ao deslogar:", err));
  perfilAnonimoAtual = false;
}

function criarConta() {
  const email = document.getElementById('email').value;
  const senhaEl = document.getElementById('senha');
  const senha = senhaEl ? senhaEl.value : '';

  if (!email || !senha) return alert('Campos vazios.');
  auth.createUserWithEmailAndPassword(email, senha).then(() => { 
    if (senhaEl) senhaEl.value = '';
    loginExitosa(); 
  }).catch(err => alert(err.message));
}

function abrirModalLogin() { 
  const m = document.getElementById('loginPage'); 
  if (!m) return;
  m.style.display = 'flex';
  requestAnimationFrame(() => m.classList.add('open'));
}

function fecharModalLogin() { 
  const m = document.getElementById('loginPage'); 
  if (!m) return;
  
  const senhaEl = document.getElementById('senha');
  if (senhaEl) senhaEl.value = '';
  
  m.classList.remove('open');
  setTimeout(() => { m.style.display = 'none'; }, 220);
}

function toggleMenuPerfil(e) { e.stopPropagation(); const m = document.getElementById('menuFlutuantePerfil'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; }

// ===================================================
// 6. SONAR / GEOLOCALIZAÇÃO
// ===================================================
function iniciarRadar() {
  if (!auth.currentUser) { abrirModalLogin(); return; }
  if (!radarAtivo) {
    radarAtivo = true; 
    document.getElementById('btnRadar').innerText = "Desligar Sonar"; 
    document.getElementById('textoRadar').innerText = "Radar Ativo";
    iniciarRastreio(); 
  } else {
    radarAtivo = false; 
    document.getElementById('btnRadar').innerText = "Ligar Sonar"; 

    const txtDet = document.getElementById('detalheRadar');
    const divS = document.getElementById('statusRadar');
    const txtRadar = document.getElementById('textoRadar');
    const container = document.getElementById('containerAlertasProximidade');

    if (txtDet) txtDet.innerText = "Ative o perímetro de rastreio de 500m.";
    if (divS) {
      divS.style.background = document.body.classList.contains('modo-escuro') ? "#131C2E" : "#F8FAFC";
      divS.style.borderColor = document.body.classList.contains('modo-escuro') ? "#1E293B" : "#E2E8F0";
    }
    if (txtRadar) {
      txtRadar.innerText = "Radar Desligado";
      txtRadar.style.color = document.body.classList.contains('modo-escuro') ? "#F8FAFC" : "#0F172A";
    }
    if (container) container.innerHTML = "";

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
        if (circuloRadar) {
          circuloRadar.setLatLng([latitude, longitude]);
          circuloRadar.setRadius(500);
        } else {
          circuloRadar = L.circle([latitude, longitude], {
            radius: 500,
            color: '#0284c7',
            fillColor: '#38bdf8',
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
    const temRouboPerto = alertasProximos.some(a => a.tipo.toLowerCase().includes('roubo'));

    if (alertasCriticos >= 3 || totalAlertas >= 8 || temRouboPerto) {
        nivelPerigo = 2; 
    } else if (alertasCriticos >= 2 || (alertasProximos.length >= 5 && alertasProximos.some(a => a.dist <= 250)) || totalAlertas >= 5) {
        nivelPerigo = 1; 
    } else if (totalAlertas > 0) {
        nivelPerigo = 0; 
    }

    return { nivelPerigo, totalAlertas, alertasProximos };
}

function verificarAlertasProximos() {
    const container = document.getElementById('containerAlertasProximidade');
    if (!container) return; container.innerHTML = '';

    const { nivelPerigo, totalAlertas, alertasProximos } = calcularNivelPerigo();

    const ehEscuro = document.body.classList.contains('modo-escuro');

    const cores = {
        0: { 
          statusBg: ehEscuro ? 'rgba(34, 197, 94, 0.15)' : '#F0FDF4', 
          statusBorder: '#22c55e', 
          statusText: ehEscuro ? '#86efac' : '#15803d', 
          titulo: 'Perímetro Seguro', 
          detalhe: 'Nenhuma atividade suspeita próxima.' 
        },
        1: { 
          statusBg: ehEscuro ? 'rgba(234, 179, 8, 0.15)' : '#FEFCE8', 
          statusBorder: '#eab308', 
          statusText: ehEscuro ? '#fef08a' : '#a16207', 
          titulo: 'Ameaça Detectada', 
          detalhe: `${totalAlertas} alerta(s) próximo(s)` 
        },
        2: { 
          statusBg: ehEscuro ? 'rgba(239, 68, 68, 0.2)' : '#FEF2F2', 
          statusBorder: '#ef4444', 
          statusText: ehEscuro ? '#fca5a5' : '#b91c1c', 
          titulo: 'Perímetro em Alerta', 
          detalhe: 'Incidentes recentes detectados a menos de 500m.' 
        }
    };

    const corConfig = cores[nivelPerigo];

    const txtRadar = document.getElementById('textoRadar');
    const txtDet = document.getElementById('detalheRadar');
    const divS = document.getElementById('statusRadar');

    if (divS) {
        divS.style.background = corConfig.statusBg;
        divS.style.borderColor = corConfig.statusBorder;
    }
    
    if (txtRadar) { txtRadar.innerText = corConfig.titulo; txtRadar.style.color = corConfig.statusText; }
    if (txtDet) { txtDet.innerText = corConfig.detalhe; txtDet.style.color = corConfig.statusText; }

    alertasProximos.slice(0, 3).forEach(alerta => {
        const iconEmoji = alerta.dist < 250 ? '🔴' : '🟡';
        container.innerHTML += `
          <div onclick="abrirModalHistoricoRadar()" style="color: ${corConfig.statusText}; font-weight: bold; margin-top: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;" title="Clique para abrir o histórico do perímetro">
            <span>${iconEmoji} ${alerta.tipo} - ${Math.round(alerta.dist)}m</span>
            <span style="font-size: 10px; opacity: 0.8;">🔍 abrir</span>
          </div>`;
    });
}

function centrarEmMim() {
  if (ultimaLatUsuario && ultimaLngUsuario) mapa.flyTo([ultimaLatUsuario, ultimaLngUsuario], 16);
}

// ===================================================
// 7. NAVEGAÇÃO E ALERTAS MANUAIS
// ===================================================
function mostrarPagina(id){
  const paginas = document.querySelectorAll('.pagina');
  paginas.forEach(p => p.classList.remove('ativa'));
  
  const alvo = document.getElementById(id);
  if (alvo) alvo.classList.add('ativa');
  
  const containerCarrosseis = document.querySelector('.container-carrosseis');
  if(id === 'mapaPagina') {
    if (containerCarrosseis) containerCarrosseis.style.display = 'none'; 
    setTimeout(() => { mapa.invalidateSize(); gerarMapaDeCalorDinamico(); }, 200);
  } else {
    if (containerCarrosseis) containerCarrosseis.style.setProperty('display', 'flex', 'important');
  }
}

async function salvarAlertaMapa(){
  const tipo = document.getElementById('popupTipo').value;
  const bairro = document.getElementById('popupBairro').value;
  const urgenciaUsuario = document.getElementById('popupUrgencia').value;
  const descricao = document.getElementById('popupDescricao').value;
  if(!bairro || !descricao.trim()) return alert('Preencha os dados.');

  showToast('Analisando alerta com Inteligência Artificial...', 'info', 3000);
  const triagem = await analisarAlertaComIA(tipo, descricao.trim(), urgenciaUsuario);
  if (!triagem.valido) {
    showToast(`Alerta bloqueado pela triagem: ${triagem.motivo}`, 'error', 5000);
    return;
  }

  let ehVerificado = false;
  let fotoAutor = auth.currentUser.photoURL || null;
  try {
    const userDoc = await db.collection('usuarios').doc(auth.currentUser.uid).get();
    if (userDoc.exists) {
      const uData = userDoc.data();
      ehVerificado = uData.verificado === true;
      if (uData.photoURL) fotoAutor = uData.photoURL;
    }
  } catch(e){}

  const novo = {
    tipo, bairro, descricao,
    lat: latClick || mapa.getCenter().lat, 
    lng: lngClick || mapa.getCenter().lng,
    data: firebase.firestore.FieldValue.serverTimestamp(),
    uidUsuario: auth.currentUser.uid,
    anonimo: perfilAnonimoAtual,
    autorPublico: perfilAnonimoAtual ? 'Anônimo' : (auth.currentUser.displayName || 'Utilizador da Comunidade'),
    autorFoto: fotoAutor,
    autorVerificado: ehVerificado,
    urgenciaAlegada: urgenciaUsuario,
    severidade: triagem.severidade_corrigida,
    motivoTriagem: triagem.motivo,
    contemAnexo: false,
    urlAnexo: null
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
  if (user) { 
    loginExitosa(); 
    mostrarPagina('mapaPagina'); 
  } else { 
    const btnLogin = document.getElementById('btnNavLogin');
    const btnPerfil = document.getElementById('btnNavPerfil');
    if (btnLogin) btnLogin.style.display = 'block';
    if (btnPerfil) btnPerfil.style.display = 'none';
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
    const tipo = escaparHTML(a.tipo);
    const descricao = escaparHTML(a.descricao);
    const bairro = escaparHTML(a.bairro);
    container.innerHTML += `
      <div class="card-carrossel-item" onclick="irParaAlerta(${a.lat}, ${a.lng})" style="min-width:200px; padding:10px; background:#fff; border-radius:8px; margin-right:10px; border:1px solid #e2e8f0; cursor:pointer;">
        <strong>🚨 ${tipo}</strong><p style="font-size:11px; color:#64748b; margin-top:4px;">${descricao}</p><small style="color:#94a3b8;">📍 ${bairro}</small>
      </div>`;
  });
}

function abrirFoto(url) {
  const modal = document.getElementById('modal-imagem-global');
  const imgConteudo = document.getElementById('imagem-ampliada-conteudo');
  imgConteudo.src = url; 
  modal.style.display = 'flex'; 
}

// ===================================================
// 8. INTEGRAÇÃO COM GEMINI IA
// ===================================================
const GEMINI_API_KEY = "Chave_Aleatoria";

async function analisarAlertaComIA(tipo, descricao, urgenciaUsuario = 'NAO INFORMADA') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
    Você é um assistente de triagem do app Alerta Bairro em Manaus.
    Analise a ocorrência:
    - Categoria: "${tipo}"
    - Descrição: "${descricao}"
    - Urgência declarada: "${urgenciaUsuario}"

    REGRAS DE BLOQUEIO (OBRIGATÓRIAS):
    1. Se o texto for apenas gírias, saudações, palavras soltas ou sem sentido, retorne "valido": false.
    2. Se o texto não explicar O QUE aconteceu de verdade, retorne "valido": false.
    3. Apenas se for um RELATO REAL E CLARO de segurança/infraestrutura, retorne "valido": true.

    Retorne apenas JSON:
    {
      "valido": true,
      "severidade_corrigida": "MEDIA",
      "motivo": "Justificativa curta"
    }`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
        const data = await response.json();
        const textoResposta = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textoResposta) throw new Error('Resposta vazia');

        const resultado = JSON.parse(textoResposta);

        return {
            valido: typeof resultado.valido === 'boolean' ? resultado.valido : true,
            severidade_corrigida: ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'].includes(resultado.severidade_corrigida) 
                ? resultado.severidade_corrigida 
                : (urgenciaUsuario !== 'NAO INFORMADA' ? urgenciaUsuario : 'MEDIA'),
            motivo: resultado.motivo || "Triagem concluída."
        };

    } catch (err) {
        return { 
            valido: true, 
            severidade_corrigida: urgenciaUsuario !== 'NAO INFORMADA' ? urgenciaUsuario : 'MEDIA', 
            motivo: "Alerta aprovado automaticamente." 
        };
    }
}

let mediaRecorderIA = null;
let audioChunksIA = [];
let gravandoIA = false;

function alternarGravacaoVozIA() {
  if (!auth.currentUser) { abrirModalLogin(); return; }
  if (!gravandoIA) iniciarGravacaoVozIA();
  else pararGravacaoVozIA();
}

async function iniciarGravacaoVozIA() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderIA = new MediaRecorder(stream);
    audioChunksIA = [];

    mediaRecorderIA.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksIA.push(event.data);
    };

    mediaRecorderIA.onstop = async () => {
      const audioBlob = new Blob(audioChunksIA, { type: mediaRecorderIA.mimeType || 'audio/webm' });
      const base64Audio = await converterBlobParaBase64(audioBlob);
      await processarAudioComGemini(base64Audio, mediaRecorderIA.mimeType || 'audio/webm');
    };

    mediaRecorderIA.start();
    gravandoIA = true;

    document.getElementById('modalVozIA').style.display = 'block';
    document.getElementById('iconeVozIA').classList.add('gravando');
    document.getElementById('tituloVozIA').innerText = "Escutando seu relato...";
  } catch (err) {
    alert("Permissão de microfone negada ou não encontrada.");
  }
}

function pararGravacaoVozIA() {
  if (mediaRecorderIA && gravandoIA) {
    mediaRecorderIA.stop();
    mediaRecorderIA.stream.getTracks().forEach(track => track.stop());
    gravandoIA = false;
    document.getElementById('iconeVozIA').classList.remove('gravando');
    document.getElementById('tituloVozIA').innerText = "✨ Processando relato...";
  }
}

function converterBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function processarAudioComGemini(base64Audio, mimeType) {
  const caixaLive = document.getElementById('caixaAnaliseLive');
  const textoLive = document.getElementById('textoAnaliseLive');

  if (caixaLive) caixaLive.style.display = 'block';

  try {
    if (textoLive) textoLive.innerText = "🧠 Identificando tipo de ocorrência e localização...";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: mimeType.split(';')[0], data: base64Audio } },
            { text: `Extraia JSON puro: {"tipo": "Roubo"|"Falta de Luz"|"Alagamento"|"Acidente de Trânsito", "descricao": "resumo", "bairro_mencionado": "nome do bairro em Manaus"}` }
          ]
        }]
      })
    });

    const data = await response.json();
    const jsonLimpo = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```json/g, '').replace(/```/g, '').trim();
    const dadosOcorrencia = JSON.parse(jsonLimpo);

    if (!dadosOcorrencia.bairro_mencionado) {
      showToast("Bairro não identificado no áudio. Fale o local claramente.", "error", 4000);
      fecharModalVozIA();
      return;
    }

    const resGeo = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dadosOcorrencia.bairro_mencionado + ', Manaus')}&format=json&limit=1`);
    const dadosGeo = await resGeo.json();
    const geoLocal = (dadosGeo && dadosGeo.length > 0) ? { lat: parseFloat(dadosGeo[0].lat), lng: parseFloat(dadosGeo[0].lon), nomeOficial: dadosOcorrencia.bairro_mencionado } : null;

    if (!geoLocal) {
      showToast("Bairro não localizado em Manaus.", "error", 4000);
      fecharModalVozIA();
      return;
    }

    cadastrarAlertaGeradoPorIA({
      tipo: dadosOcorrencia.tipo,
      descricao: dadosOcorrencia.descricao,
      bairro: geoLocal.nomeOficial,
      lat: geoLocal.lat,
      lng: geoLocal.lng
    });

  } catch (error) {
    showToast("Erro ao processar áudio. Tente novamente.", "error", 4000);
    fecharModalVozIA();
  }
}

async function cadastrarAlertaGeradoPorIA(dados) {
  const triagem = await analisarAlertaComIA(dados.tipo, dados.descricao);

  let ehVerificado = false;
  let fotoAutor = auth.currentUser.photoURL || null;
  try {
    const userDoc = await db.collection('usuarios').doc(auth.currentUser.uid).get();
    if (userDoc.exists) {
      const uData = userDoc.data();
      ehVerificado = uData.verificado === true;
      if (uData.photoURL) fotoAutor = uData.photoURL;
    }
  } catch(e){}

  const novoAlerta = {
    tipo: dados.tipo || "Outro",
    bairro: dados.bairro,
    descricao: `[Relato por Voz IA] ${dados.descricao}`,
    lat: dados.lat,
    lng: dados.lng,
    data: firebase.firestore.FieldValue.serverTimestamp(),
    uidUsuario: auth.currentUser.uid,
    anonimo: perfilAnonimoAtual,
    autorPublico: perfilAnonimoAtual ? 'Anônimo' : (auth.currentUser.displayName || 'Utilizador da Comunidade'),
    autorFoto: fotoAutor,
    autorVerificado: ehVerificado,
    contemAnexo: false,
    urlAnexo: null,
    criadoPorIA: true,
    severidade: triagem.severidade_corrigida,
    motivoTriagem: triagem.motivo
  };

  db.collection("alertas").add(novoAlerta).then(() => {
    fecharModalVozIA();
    showToast(`🚨 Alerta em ${novoAlerta.bairro} publicado!`, 'success');
    mapa.flyTo([dados.lat, dados.lng], 16, { animate: true });
  });
}

function fecharModalVozIA() {
  const modal = document.getElementById('modalVozIA');
  if (modal) modal.style.display = 'none';
}

// ===================================================
// 9. CONFIGURAÇÕES E MODAIS PERFIL / SEGURANÇA
// ===================================================
function abrirModalConfiguracoes() {
  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';
  const modal = document.getElementById('modalConfiguracoes');
  if (modal) { modal.style.display = 'flex'; requestAnimationFrame(() => modal.classList.add('open')); }
}

function fecharModalConfiguracoes() {
  const modal = document.getElementById('modalConfiguracoes');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 220);
}

function abrirSubmenuDisplay() {
  document.getElementById('painelPrincipalConfig').style.display = 'none';
  document.getElementById('submenuDisplayConfig').style.display = 'block';
}

function fecharSubmenuDisplay() {
  document.getElementById('painelPrincipalConfig').style.display = 'block';
  document.getElementById('submenuDisplayConfig').style.display = 'none';
}

function abrirSubmenuNotificacoes() {
  document.getElementById('painelPrincipalConfig').style.display = 'none';
  document.getElementById('submenuNotificacoes').style.display = 'block';
}

function fecharSubmenuNotificacoes() {
  document.getElementById('painelPrincipalConfig').style.display = 'block';
  document.getElementById('submenuNotificacoes').style.display = 'none';
}

function alternarPreferenciaPush() {
  pushHabilitadoPeloUsuario = document.getElementById('switchPushNotificacao').checked;
}

function alternarTelaEdicao(mostrarEdicao) {
  document.getElementById('telaVisualizacaoPerfil').style.display = mostrarEdicao ? 'none' : 'block';
  document.getElementById('telaEdicaoPerfil').style.display = mostrarEdicao ? 'block' : 'none';
}

function atualizarPreviewFoto(url) {
  const img = document.getElementById('previewFotoEdit');
  const fallback = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  if (img) {
    img.src = (url && url.trim() !== '') ? url : fallback;
  }
}

function atualizarContadorBio() {
  const campo = document.getElementById('inputEditBio');
  const contador = document.getElementById('contadorBio');
  if (campo && contador) {
    contador.innerText = `${campo.value.length}/200`;
  }
}

function carregarFotoArquivoLocal(input) {
  if (input.files && input.files[0]) {
    const arquivo = input.files[0];

    const leitor = new FileReader();
    leitor.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const maxDim = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const base64Comprimido = canvas.toDataURL('image/jpeg', 0.8);

        const inputURL = document.getElementById('inputEditFotoURL');
        if (inputURL) {
          inputURL.value = base64Comprimido;
        }
        
        atualizarPreviewFoto(base64Comprimido);
        showToast('Imagem otimizada e pronta para salvar!', 'success');
      };
      img.src = e.target.result;
    };

    leitor.readAsDataURL(arquivo);
  }
}

// VALIDAÇÃO MATEMÁTICA DE CPF (MÓDULO 11)
function validarCPF(cpfStr) {
  if (!cpfStr) return false;
  const cpf = cpfStr.replace(/[^\d]+/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0;
  for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10))) return false;

  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(10, 11))) return false;

  return true;
}

function formatarCPF(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 11) v = v.slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  input.value = v;

  const dica = document.getElementById('dicaValidadeCPF');
  if (dica && v.length === 14) {
    const ehValido = validarCPF(v);
    dica.innerText = ehValido ? "🟢 CPF matematicamente válido!" : "🔴 CPF inválido. Verifique os dígitos.";
    dica.style.color = ehValido ? "#22c55e" : "#ef4444";
  } else if (dica) {
    dica.innerText = "O CPF é único por conta e passa por validação matemática de dígitos.";
    dica.style.color = "#94a3b8";
  }
}

function formatarTelefone(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 11) v = v.slice(0, 11);
  v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
  v = v.replace(/(\d)(\d{4})$/, '$1-$2');
  input.value = v;
}

function calcularProgressoVerificacao(user, dadosFirestore) {
  let pontos = 0;
  const emailOk = user && user.emailVerified === true;
  const telOk = Boolean(dadosFirestore && dadosFirestore.telefone && dadosFirestore.telefone.replace(/\D/g, '').length >= 10);
  const cpfOk = Boolean(dadosFirestore && dadosFirestore.cpf && validarCPF(dadosFirestore.cpf));

  if (emailOk) pontos += 34;
  if (telOk) pontos += 33;
  if (cpfOk) pontos += 33;

  return {
    porcentagem: pontos,
    emailOk,
    telOk,
    cpfOk,
    completo: pontos === 100
  };
}

async function abrirModalPerfil() {
  const user = auth.currentUser;
  const modal = document.getElementById('modalPerfilUsuario');
  if (!user || !modal) return;

  fecharModalConfiguracoes();
  alternarTelaEdicao(false);

  const fallbackFoto = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2364748b"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

  let fotoURL = user.photoURL || '';
  let nomeExibicao = user.displayName || '';
  let dadosFirestore = {};

  try {
    const doc = await db.collection('usuarios').doc(user.uid).get();
    if (doc.exists) {
      dadosFirestore = doc.data();
      if (dadosFirestore.photoURL && dadosFirestore.photoURL.trim() !== '') fotoURL = dadosFirestore.photoURL;
      if (dadosFirestore.nome && dadosFirestore.nome.trim() !== '') nomeExibicao = dadosFirestore.nome;
      
      document.getElementById('bioPerfilAtual').innerText = dadosFirestore.bio || 'Sem biografia definida.';
      document.getElementById('inputEditBio').value = dadosFirestore.bio || '';
      document.getElementById('inputEditBairro').value = dadosFirestore.bairroFavorito || '';
      document.getElementById('checkAnonimo').checked = dadosFirestore.anonimo === true;
      document.getElementById('statusAnonimoPerfil').innerText = dadosFirestore.anonimo === true ? 'Sim' : 'Não';
    }
  } catch (e) {
    console.error("Erro ao carregar dados do perfil:", e);
  }

  await user.reload();
  const progresso = calcularProgressoVerificacao(user, dadosFirestore);

  const seloEl = document.getElementById('txtPerfilSeloVerificacao');
  if (seloEl) {
    seloEl.innerText = progresso.completo 
      ? "🟢 Conta 100% Verificada" 
      : `⚪ Não Verificada (${progresso.porcentagem}%)`;
  }

  const tooltipBox = document.getElementById('tooltipChecklistVerificacao');
  if (tooltipBox) {
    tooltipBox.innerHTML = `
      <div style="font-size:11px; color:#FFFFFF;">
        <strong style="display:block; margin-bottom:8px; color:#E5B842; font-size:12px;">Checklist de Segurança</strong>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
          <span>📧 E-mail verificado</span>
          <span>${progresso.emailOk ? '✅' : '❌'}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
          <span>📱 Telemóvel de recuperação</span>
          <span>${progresso.telOk ? '✅' : '❌'}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span>🪪 CPF do titular válido</span>
          <span>${progresso.cpfOk ? '✅' : '❌'}</span>
        </div>
        <hr style="border:0; border-top:1px solid #1E293B; margin:8px 0;">
        <small style="color:#94A3B8; font-size:10px;">Acesse "Segurança e Verificação" no menu para concluir.</small>
      </div>
    `;
  }

  document.getElementById('imgPerfilAtual').src = fotoURL || fallbackFoto;
  document.getElementById('nomePerfilAtual').innerText = nomeExibicao || 'Utilizador da Comunidade';
  document.getElementById('inputEditNome').value = nomeExibicao;
  document.getElementById('inputEditFotoURL').value = fotoURL;
  atualizarPreviewFoto(fotoURL);

  atualizarContadorBio();
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
}

function fecharModalPerfil() {
  const modal = document.getElementById('modalPerfilUsuario');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 220);
}

function voltarParaConfiguracoes() {
  fecharModalPerfil();
  abrirModalConfiguracoes();
}

async function salvarPerfilUsuario() {
  const user = auth.currentUser;
  if (!user) return;

  const novoNome = document.getElementById('inputEditNome').value.trim();
  const novaFotoURL = document.getElementById('inputEditFotoURL').value.trim();
  const novaBio = document.getElementById('inputEditBio').value.trim();
  const novoBairro = document.getElementById('inputEditBairro').value.trim();
  const anonimato = document.getElementById('checkAnonimo').checked;

  try {
    try {
      await user.updateProfile({
        displayName: novoNome,
        photoURL: novaFotoURL
      });
    } catch (authError) {
      console.warn("Aviso ao atualizar photoURL no Auth, salvando no Firestore:", authError);
    }

    await db.collection('usuarios').doc(user.uid).set({
      nome: novoNome,
      photoURL: novaFotoURL,
      bio: novaBio,
      bairroFavorito: novoBairro,
      anonimo: anonimato
    }, { merge: true });

    perfilAnonimoAtual = anonimato;

    const fallbackFoto = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2364748b"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    document.getElementById('nomePerfilAtual').innerText = novoNome || 'Utilizador da Comunidade';
    document.getElementById('bioPerfilAtual').innerText = novaBio || 'Sem biografia definida.';
    document.getElementById('imgPerfilAtual').src = novaFotoURL || fallbackFoto;
    document.getElementById('perfilNome').innerText = novoNome || 'Utilizador';
    document.getElementById('perfilFoto').src = novaFotoURL || fallbackFoto;

    const imgNav = document.getElementById('navPerfilFoto');
    if (imgNav) imgNav.src = novaFotoURL || fallbackFoto;

    document.getElementById('statusAnonimoPerfil').innerText = anonimato ? 'Sim' : 'Não';

    showToast('Perfil atualizado com sucesso!', 'success');
    alternarTelaEdicao(false);
  } catch (err) {
    showToast('Erro ao salvar alterações do perfil.', 'error');
    console.error(err);
  }
}

// ===================================================
// MODAL DE SEGURANÇA E UNICIDADE DO CPF
// ===================================================
async function abrirModalSeguranca() {
  const user = auth.currentUser;
  if (!user) { abrirModalLogin(); return; }

  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';

  const modal = document.getElementById('modalSeguranca');
  if (!modal) return;

  await user.reload();
  const emailVerif = user.emailVerified;
  document.getElementById('txtEmailVerificadoStatus').innerText = emailVerif 
    ? '🟢 E-mail confirmado' 
    : '🔴 E-mail pendente de confirmação';

  let dadosFirestore = {};
  try {
    const doc = await db.collection('usuarios').doc(user.uid).get();
    if (doc.exists) {
      dadosFirestore = doc.data();
      document.getElementById('inputSegurancaTelefone').value = dadosFirestore.telefone || '';
      document.getElementById('inputSegurancaCPF').value = dadosFirestore.cpf || '';
    }
  } catch(e) {}

  const progresso = calcularProgressoVerificacao(user, dadosFirestore);
  atualizarUIStatusVerificacao(progresso);

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
}

function fecharModalSeguranca() {
  const modal = document.getElementById('modalSeguranca');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 220);
}

function atualizarUIStatusVerificacao(progresso) {
  const icone = document.getElementById('iconeStatusGeralVerificacao');
  const titulo = document.getElementById('tituloStatusGeralVerificacao');
  const desc = document.getElementById('descStatusGeralVerificacao');
  const txtPct = document.getElementById('porcentagemProgressoTexto');
  const barraPreenchimento = document.getElementById('barraProgressoPreenchimento');

  if (txtPct) txtPct.innerText = `${progresso.porcentagem}%`;
  if (barraPreenchimento) barraPreenchimento.style.width = `${progresso.porcentagem}%`;

  if (progresso.completo) {
    if (icone) icone.innerText = '🟢';
    if (titulo) titulo.innerText = 'Conta 100% Verificada';
    if (desc) desc.innerText = 'Os seus alertas possuem o selo de autenticidade ativo para toda a comunidade.';
  } else {
    if (icone) icone.innerText = '⚪';
    if (titulo) titulo.innerText = 'Conta Parcialmente Verificada';
    let pendencias = [];
    if (!progresso.emailOk) pendencias.push('confirmação de e-mail');
    if (!progresso.telOk) pendencias.push('telemóvel');
    if (!progresso.cpfOk) pendencias.push('CPF válido');

    if (desc) desc.innerText = `Pendente de: ${pendencias.join(', ')}.`;
  }
}

async function guardarDadosSeguranca() {
  const user = auth.currentUser;
  if (!user) return;

  const tel = document.getElementById('inputSegurancaTelefone').value.trim();
  const cpf = document.getElementById('inputSegurancaCPF').value.trim();

  if (cpf.length > 0) {
    if (!validarCPF(cpf)) {
      showToast('CPF inválido! Verifique os números digitados.', 'error', 4000);
      return;
    }

    try {
      const cpfQuery = await db.collection('usuarios').where('cpf', '==', cpf).get();
      let cpfEmUsoPorOutro = false;
      cpfQuery.forEach(doc => {
        if (doc.id !== user.uid) cpfEmUsoPorOutro = true;
      });

      if (cpfEmUsoPorOutro) {
        showToast('Este CPF já está associado a outra conta registrada!', 'error', 4500);
        return;
      }
    } catch(e) {
      console.error("Erro ao verificar unicidade do CPF:", e);
    }
  }

  await user.reload();
  const dadosParaGuardar = { telefone: tel, cpf: cpf };
  const progresso = calcularProgressoVerificacao(user, dadosParaGuardar);
  dadosParaGuardar.verificado = progresso.completo;

  try {
    await db.collection('usuarios').doc(user.uid).set(dadosParaGuardar, { merge: true });

    atualizarUIStatusVerificacao(progresso);
    showToast('Dados de segurança salvos com sucesso!', 'success');
    fecharModalSeguranca();
  } catch(e) {
    showToast('Erro ao guardar dados de segurança.', 'error');
  }
}

function enviarEmailVerificacaoFirebase() {
  const user = auth.currentUser;
  if (user) {
    user.sendEmailVerification()
      .then(() => showToast('E-mail de verificação enviado! Verifique a sua caixa de entrada.', 'success', 4000))
      .catch(() => showToast('Erro ao enviar e-mail de verificação.', 'error'));
  }
}

function solicitarRedefinicaoSenha() {
  const user = auth.currentUser;
  if (user && user.email) {
    auth.sendPasswordResetEmail(user.email)
      .then(() => showToast('Link de redefinição enviado para o seu e-mail!', 'success', 4000))
      .catch(() => showToast('Erro ao solicitar redefinição.', 'error'));
  }
}

function abrirLinhaDoTempo() {
  const user = auth.currentUser;
  if (!user) { abrirModalLogin(); return; }
  fecharModalConfiguracoes();
  const modal = document.getElementById('modalLinhaDoTempo');
  if (modal) { modal.style.display = 'flex'; requestAnimationFrame(() => modal.classList.add('open')); }
  carregarLinhaDoTempoUsuario(user.uid);
}

function fecharLinhaDoTempo() {
  const modal = document.getElementById('modalLinhaDoTempo');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 220);
}

function carregarLinhaDoTempoUsuario(uid) {
  const container = document.getElementById('listaLinhaDoTempo');
  if (!container || !uid) return;

  db.collection('alertas').where('uidUsuario', '==', uid).get().then(snapshot => {
    if (snapshot.empty) {
      container.innerHTML = '<p style="text-align:center; font-size:12px; color:#64748b; padding:20px;">Você ainda não registrou nenhum alerta.</p>';
      return;
    }
    const registros = snapshot.docs.map(doc => doc.data());
    const fallbackFoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

    container.innerHTML = registros.map(alerta => {
      const ehAnonimo = alerta.anonimo === true;
      const autorNome = ehAnonimo ? 'Utilizador Anónimo' : (alerta.autorPublico || 'Utilizador da Comunidade');
      const autorFoto = ehAnonimo ? fallbackFoto : (alerta.autorFoto || fallbackFoto);

      return `
        <div class="card-alerta-radar-item severidade-${alerta.severidade || 'MEDIA'}" onclick="irParaAlerta(${alerta.lat}, ${alerta.lng}); fecharLinhaDoTempo();" style="cursor:pointer;">
          <div class="topo-card-radar">
            <div class="autor-card-radar">
              <img src="${escaparHTML(autorFoto)}" class="avatar-autor-radar" alt="Autor">
              <strong>${escaparHTML(autorNome)}</strong>
            </div>
            <span class="meta-card-radar">📍 ${escaparHTML(alerta.bairro)} • 🕒 ${formatarDataHora(alerta.data)}</span>
          </div>
          <div class="corpo-card-radar"><strong>🚨 ${escaparHTML(alerta.tipo)}:</strong> ${escaparHTML(alerta.descricao)}</div>
        </div>
      `;
    }).join('');
  });
}

function abrirModalHistoricoRadar() {
  const modal = document.getElementById('modalHistoricoRadar');
  if (modal) { modal.style.display = 'flex'; requestAnimationFrame(() => modal.classList.add('open')); }
  renderizarAlertasRadarArea();
}

function fecharModalHistoricoRadar() {
  const modal = document.getElementById('modalHistoricoRadar');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 220);
}

function renderizarAlertasRadarArea() {
  const container = document.getElementById('listaAlertasRadarArea');
  if (!container || !ultimaLatUsuario || !ultimaLngUsuario) return;

  const pontoUsuario = L.latLng(ultimaLatUsuario, ultimaLngUsuario);
  let ocorrenciasPerimetro = alertas.filter(a => a.lat && a.lng && pontoUsuario.distanceTo(L.latLng(a.lat, a.lng)) <= 500);

  if (ocorrenciasPerimetro.length === 0) {
    container.innerHTML = '<p style="text-align:center; font-size:12px; color:#64748b; padding:20px;">Nenhum alerta nos 500m do radar.</p>';
    return;
  }

  const fallbackFoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

  container.innerHTML = ocorrenciasPerimetro.map(alerta => {
    const ehAnonimo = alerta.anonimo === true;
    const autorNome = ehAnonimo ? 'Utilizador Anónimo' : (alerta.autorPublico || 'Utilizador da Comunidade');
    const autorFoto = ehAnonimo ? fallbackFoto : (alerta.autorFoto || fallbackFoto);

    return `
      <div class="card-alerta-radar-item severidade-${alerta.severidade || 'MEDIA'}" onclick="irParaAlerta(${alerta.lat}, ${alerta.lng}); fecharModalHistoricoRadar();" style="cursor:pointer;">
        <div class="topo-card-radar">
          <div class="autor-card-radar">
            <img src="${escaparHTML(autorFoto)}" class="avatar-autor-radar" alt="Autor">
            <strong>${escaparHTML(autorNome)}</strong>
          </div>
          <span class="meta-card-radar">📍 ${Math.round(pontoUsuario.distanceTo(L.latLng(alerta.lat, alerta.lng)))}m • 🕒 ${formatarDataHora(alerta.data)}</span>
        </div>
        <div class="corpo-card-radar"><strong>🚨 ${escaparHTML(alerta.tipo)}:</strong> ${escaparHTML(alerta.descricao)}</div>
      </div>
    `;
  }).join('');
}