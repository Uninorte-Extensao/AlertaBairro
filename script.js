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

const mapa = L.map('mapa', { attributionControl: false, zoomControl: false }).setView([-3.1190, -60.0217], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);

// ===================================================
// FORMULÁRIO DO MAPA
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
    <div style="font-family: sans-serif; min-width:180px;">
      <h3 style="font-size:13px; margin-bottom:6px; color:#0A2540;">Novo Alerta (${nivelAcessoUsuarioAtual.toUpperCase()})</h3>
      <select id="popupTipo" style="padding:4px; font-size:11px; width:100%;">
        ${opcoesSelect}
      </select>
      <input type="text" id="popupBairro" placeholder="Buscando bairro..." readonly style="padding:4px; font-size:11px; margin-top:4px; width:100%;">
      <select id="popupUrgencia" style="padding:4px; font-size:11px; margin-top:4px; width:100%; border:1px solid #ef4444; color:#b91c1c; font-weight:600;">
        <option value="BAIXA">🟢 Perigo baixo</option>
        <option value="MEDIA" selected>🟡 Perigo médio</option>
        <option value="ALTA">🟠 Perigo alto</option>
        <option value="CRITICA">🔴 Emergência crítica</option>
      </select>
      <textarea id="popupDescricao" rows="2" placeholder="Descreva o incidente..." style="padding:4px; font-size:11px; margin-top:4px; width:100%;"></textarea>
      <button onclick="salvarAlertaMapa()" style="margin-top:6px; padding:6px; width:100%; background:#D9383A; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer;">Salvar Alerta</button>
    </div>`;
}

mapa.on('click', function(e) {
  const menuPerfil = document.getElementById('menuFlutuantePerfil');
  if (menuPerfil) menuPerfil.style.display = 'none';

  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }

  if (typeof selecionandoLocalManualmente !== 'undefined' && selecionandoLocalManualmente === true) {
    ultimaLatUsuario = e.latlng.lat;
    ultimaLngUsuario = e.latlng.lng;
    selecionandoLocalManualmente = false; 
    abrirModalAlertaExpandido();
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

  ultimoPopup = L.popup({ closeOnClick: false })
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

    const manchaRegiao = L.circle([grupo.lat, grupo.lng], {
      color: corCalor, 
      fillColor: corCalor, 
      fillOpacity: 0.18, 
      weight: 1.5, 
      radius: 600,
      interactive: false
    }).addTo(mapa);

    const iconeGrafico = L.divIcon({
        className: 'icone-estatistica',
        html: `<div style="font-size: 22px; text-shadow: 0px 0px 4px white; cursor: pointer;">📊</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
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
          <div class="coluna-texto-alerta">
              <div class="alerta-header">
                <span class="alerta-titulo-tipo">🚨 ${tipo}</span>
                <span class="alerta-bairro">📍 ${bairro}</span>
            </div>
              <div class="alerta-corpo">${descricao}</div>
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
      const severidade = alerta.severidade || 'MEDIA';
      const marcador = L.marker([alerta.lat, alerta.lng], {
        icon: obterIconeAlerta(severidade),
        tipoAlerta: alerta.tipo
      }).addTo(mapa);
      marcador.bindPopup(`<strong>🚨 ${escaparHTML(alerta.tipo)}</strong><br>Prioridade: ${escaparHTML(severidade)}<br>${escaparHTML(alerta.descricao)}`);
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
// 4. MODO ESCURO E TEMAS (RESTAURADO E CORRIGIDO)
// ===================================================
function alternarModoEscuro(ativo) {
  if (ativo) {
    document.body.classList.add('modo-escuro');
    localStorage.setItem('temaAlertaBairro', 'escuro');
  } else {
    document.body.classList.remove('modo-escuro');
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
  if (temaSalvo === 'escuro') {
    document.body.classList.add('modo-escuro');
    if (switchEscuro) switchEscuro.checked = true;
  } else {
    document.body.classList.remove('modo-escuro');
    if (switchEscuro) switchEscuro.checked = false;
  }
}

document.addEventListener('DOMContentLoaded', carregarTemaSalvo);

// ===================================================
// 5. AUTENTICAÇÃO E PERFIL
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
  const btnLogin = document.getElementById('btnNavLogin');
  const btnPerfil = document.getElementById('btnNavPerfil');
  if (btnLogin) btnLogin.style.display = 'none';
  if (btnPerfil) btnPerfil.style.display = 'block';
  
  const user = auth.currentUser;
  if (user) { 
    atualizarDadosPerfilTela(user); 
    carregarPreferenciasPerfil(user);
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
  const senha = document.getElementById('senha').value;
  if (!email || !senha) return alert('Campos vazios.');
  auth.createUserWithEmailAndPassword(email, senha).then(() => { loginExitosa(); }).catch(err => alert(err.message));
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
  m.classList.remove('open');
  setTimeout(() => { m.style.display = 'none'; }, 220);
}

function toggleMenuPerfil(e) { e.stopPropagation(); const m = document.getElementById('menuFlutuantePerfil'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; }

function atualizarDadosPerfilTela(user) {
  if (user) {
    document.getElementById('perfilNome').innerText = user.displayName || "Usuário Comunitário";
    document.getElementById('perfilEmail').innerText = user.email || "sem-email@provedor.com";
    document.getElementById('perfilFoto').src = user.photoURL || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239aa0a6'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  }
}

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
      divS.style.background = document.body.classList.contains('modo-escuro') ? "#131C2E" : "#F1F5F9";
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

    const cores = {
        0: { statusBg: 'rgba(34, 197, 94, 0.15)', statusBorder: '#22c55e', statusText: '#15803d', titulo: 'Perímetro Seguro', detalhe: 'Nenhuma atividade suspeita próxima.' },
        1: { statusBg: 'rgba(234, 179, 8, 0.15)', statusBorder: '#eab308', statusText: '#a16207', titulo: 'Ameaça Detectada', detalhe: `${totalAlertas} alerta(s) próximo(s)` },
        2: { statusBg: 'rgba(239, 68, 68, 0.2)', statusBorder: '#ef4444', statusText: '#b91c1c', titulo: 'Perímetro em Alerta', detalhe: 'Incidentes recentes detectados a menos de 500m.' }
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

  const novo = {
    tipo, bairro, descricao,
    lat: latClick || mapa.getCenter().lat, 
    lng: lngClick || mapa.getCenter().lng,
    data: firebase.firestore.FieldValue.serverTimestamp(),
    uidUsuario: auth.currentUser.uid,
    anonimo: perfilAnonimoAtual,
    autorPublico: perfilAnonimoAtual ? 'Anônimo' : (auth.currentUser.displayName || 'Usuário da Comunidade'),
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
const GEMINI_API_KEY = "AQ.Ab8RN6L-J9NftuNSZSl2i95rw17IMVMaXUJ48oohKKbIHWFkTQ";

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

  const novoAlerta = {
    tipo: dados.tipo || "Outro",
    bairro: dados.bairro,
    descricao: `[Relato por Voz IA] ${dados.descricao}`,
    lat: dados.lat,
    lng: dados.lng,
    data: firebase.firestore.FieldValue.serverTimestamp(),
    uidUsuario: auth.currentUser.uid,
    anonimo: perfilAnonimoAtual,
    autorPublico: perfilAnonimoAtual ? 'Anônimo' : (auth.currentUser.displayName || 'Usuário da Comunidade'),
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
// 9. CONFIGURAÇÕES E MODAIS PERFIL / LINHA DO TEMPO
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

function carregarPreferenciasPerfil(user) {
  if (!user) return Promise.resolve();
  return db.collection('usuarios').doc(user.uid).get().then(doc => {
    const dados = doc.exists ? doc.data() : {};
    perfilAnonimoAtual = dados.anonimo === true;
  });
}

function alternarTelaEdicao(mostrarEdicao) {
  document.getElementById('telaVisualizacaoPerfil').style.display = mostrarEdicao ? 'none' : 'block';
  document.getElementById('telaEdicaoPerfil').style.display = mostrarEdicao ? 'block' : 'none';
}

async function abrirModalPerfil() {
  const user = auth.currentUser;
  const modal = document.getElementById('modalPerfilUsuario');
  if (!user || !modal) return;

  fecharModalConfiguracoes();
  alternarTelaEdicao(false);

  document.getElementById('perfilFoto').src = user.photoURL || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2364748b"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  document.getElementById('nomePerfilAtual').innerText = user.displayName || 'Usuário da Comunidade';
  document.getElementById('inputEditNome').value = user.displayName || '';

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
  const novaBio = document.getElementById('inputEditBio').value.trim();
  const anonimato = document.getElementById('checkAnonimo').checked;

  await user.updateProfile({ displayName: novoNome });
  await db.collection('usuarios').doc(user.uid).set({
    nome: novoNome,
    bio: novaBio,
    anonimo: anonimato
  }, { merge: true });

  perfilAnonimoAtual = anonimato;
  document.getElementById('nomePerfilAtual').innerText = novoNome;
  document.getElementById('bioPerfilAtual').innerText = novaBio || 'Sem biografia definida.';
  showToast('Perfil atualizado com sucesso!', 'success');
  alternarTelaEdicao(false);
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
    container.innerHTML = registros.map(alerta => `
      <div class="card-alerta-radar-item severidade-${alerta.severidade || 'MEDIA'}" onclick="irParaAlerta(${alerta.lat}, ${alerta.lng}); fecharLinhaDoTempo();" style="cursor:pointer;">
        <div class="topo-card-radar">
          <strong>🚨 ${escaparHTML(alerta.tipo)}</strong>
          <span class="meta-card-radar">📍 ${escaparHTML(alerta.bairro)}</span>
        </div>
        <div class="corpo-card-radar">${escaparHTML(alerta.descricao)}</div>
      </div>
    `).join('');
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

  container.innerHTML = ocorrenciasPerimetro.map(alerta => `
    <div class="card-alerta-radar-item severidade-${alerta.severidade || 'MEDIA'}">
      <div class="topo-card-radar">
        <strong>🚨 ${escaparHTML(alerta.tipo)}</strong>
        <span class="meta-card-radar">📍 ${Math.round(pontoUsuario.distanceTo(L.latLng(alerta.lat, alerta.lng)))}m</span>
      </div>
      <div class="corpo-card-radar">${escaparHTML(alerta.descricao)}</div>
    </div>
  `).join('');
}