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
// OUVINTE DE CLIQUE NO MAPA
// ===================================================
mapa.on('click', function(e) {
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
// 2.1 MAPA DE CALOR
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
// 3. RECUPERAÇÃO REALTIME E FILTRAGENS
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
        else if(alerta.tipo.includes('Desaparecimento')) cssClass = 'alerta-desaparecimento';

        let urlImagem = alerta.urlAnexo || (alerta.nomeAnexo ? alerta.nomeAnexo : 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150');

        let htmlImagemDireita = '';
        if (alerta.contemAnexo || alerta.urlAnexo) {
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
// 4. AUTENTICAÇÃO E PERFIL
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
  
  const sistema = document.getElementById('sistema');
  if (sistema) sistema.style.display = 'block';
  
  document.body.classList.remove('tela-autenticacao'); 
  
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

function atualizarDadosPerfilTela(user) {
  if (user) {
    document.getElementById('perfilNome').innerText = user.displayName || "Usuário Comunitário";
    document.getElementById('perfilEmail').innerText = user.email || "sem-email@provedor.com";
    document.getElementById('perfilFoto').src = user.photoURL || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239aa0a6'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
  }
}

document.addEventListener('click', (e) => {
  const ampliada = document.querySelector('.foto-registro-lateral.ampliada');
  if (ampliada && !e.target.classList.contains('ampliada')) {
    ampliada.classList.remove('ampliada');
  }
});

// ===================================================
// 5. SONAR / GEOLOCALIZAÇÃO
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
        0: { radarColor: '#22c55e', statusBg: '#dcfce7', statusText: '#166534', titulo: 'Perímetro Seguro', detalhe: 'Nenhuma atividade suspeita próxima.' },
        1: { radarColor: '#eab308', statusBg: '#fef3c7', statusText: '#a16207', titulo: 'Ameaça Detectada', detalhe: `${totalAlertas} alerta(s) próximo(s)` },
        2: { radarColor: '#ef4444', statusBg: '#fee2e2', statusText: '#7f1d1d', titulo: 'Perímetro em Alerta', detalhe: 'Incidentes recentes detectados a menos de 500m.' }
    };

    const corConfig = cores[nivelPerigo];

    const txtRadar = document.getElementById('textoRadar');
    const txtDet = document.getElementById('detalheRadar');
    const divS = document.getElementById('statusRadar');

    if (divS) {
        divS.style.background = corConfig.statusBg;
        divS.style.color = corConfig.statusText;
        divS.style.borderColor = corConfig.radarColor;
    }
    
    if (txtRadar) { txtRadar.innerText = corConfig.titulo; txtRadar.style.color = corConfig.statusText; }
    if (txtDet) { txtDet.innerText = corConfig.detalhe; txtDet.style.color = corConfig.statusText; }

    alertasProximos.slice(0, 3).forEach(alerta => {
        const iconEmoji = alerta.dist < 250 ? '🔴' : '🟡';
        container.innerHTML += `<div style="color: #7f1d1d; font-weight: bold; margin-top: 6px; font-size: 11px;">${iconEmoji} ${alerta.tipo} - ${Math.round(alerta.dist)}m</div>`;
    });
}

function centrarEmMim() {
  if (ultimaLatUsuario && ultimaLngUsuario) mapa.flyTo([ultimaLatUsuario, ultimaLngUsuario], 16);
}

// ===================================================
// 6. NAVEGAÇÃO E ALERTAS MANUAIS
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
    container.innerHTML += `
      <div class="card-carrossel-item" onclick="irParaAlerta(${a.lat}, ${a.lng})" style="min-width:200px; padding:10px; background:#fff; border-radius:8px; margin-right:10px; border:1px solid #e2e8f0; cursor:pointer;">
        <strong>🚨 ${a.tipo}</strong><p style="font-size:11px; color:#64748b; margin-top:4px;">${a.descricao}</p><small style="color:#94a3b8;">📍 ${a.bairro}</small>
      </div>`;
  });
}

// ===================================================
// 7. MODAL EXPANDIDO DE CRIAR ALERTA
// ===================================================
function gatilhoBotaoAlertaExpandido() {
  if (!auth.currentUser) { abrirModalLogin(); return; }
  abrirModalAlertaExpandido();
}

function abrirModalAlertaExpandido() {
  const m = document.getElementById('modalAlertaExpandido'); if (!m) return;
  
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
}

let selecionandoLocalManualmente = false;

function iniciarSelecaoManualMapa() {
  selecionandoLocalManualmente = true;
  fecharModalAlertaExpandido(); 
  showToast('Toque no mapa para escolher o local do alerta', 'info', 4000);
}

function abrirFoto(url) {
  const modal = document.getElementById('modal-imagem-global');
  const imgConteudo = document.getElementById('imagem-ampliada-conteudo');
  imgConteudo.src = url; 
  modal.style.display = 'flex'; 
}

// ===================================================
// 8. TRIAGEM POR VOZ E PROCESSAMENTO DE IA (GEMINI)
// ===================================================
const GEMINI_API_KEY = "SUA_CHAVE_GEMINI_AQUI";

let mediaRecorderIA = null;
let audioChunksIA = [];
let gravandoIA = false;

// Efeito de digitação visual em tempo real
function digitarTextoEfeito(texto, elemento, velocidade = 20) {
  return new Promise((resolve) => {
    elemento.innerText = "";
    let i = 0;
    const timer = setInterval(() => {
      elemento.innerText += texto.charAt(i);
      i++;
      if (i >= texto.length) {
        clearInterval(timer);
        resolve();
      }
    }, velocidade);
  });
}

// Geolocaliza especificamente o bairro citado em Manaus
async function buscarCoordenadasBairroManaus(bairro) {
  try {
    const consulta = `${bairro}, Manaus, Amazonas, Brasil`;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(consulta)}&format=json&limit=1`);
    const dados = await res.json();

    if (dados && dados.length > 0) {
      return {
        lat: parseFloat(dados[0].lat),
        lng: parseFloat(dados[0].lon),
        nomeOficial: dados[0].display_name.split(',')[0] || bairro
      };
    }
    return null;
  } catch (err) {
    console.error("Erro ao buscar coordenadas do bairro:", err);
    return null;
  }
}

// Tradutor de erros para linguagem amigável
function obterMensagemErroAmigavel(error) {
  const textoErro = error?.message || String(error);

  if (textoErro.includes("503") || textoErro.includes("UNAVAILABLE") || textoErro.includes("high demand")) {
    return "O servidor de inteligência está em alta demanda. Tente novamente em alguns segundos.";
  }
  if (textoErro.includes("404") || textoErro.includes("NOT_FOUND")) {
    return "Serviço de análise de voz indisponível temporariamente.";
  }
  if (textoErro.includes("JSON") || textoErro.includes("parse")) {
    return "Não conseguimos entender os detalhes do relato. Grave novamente falando mais devagar.";
  }
  return "Não foi possível concluir a análise do áudio. Verifique sua conexão e tente novamente.";
}

function alternarGravacaoVozIA() {
  if (!auth.currentUser) {
    abrirModalLogin();
    return;
  }
  if (!gravandoIA) {
    iniciarGravacaoVozIA();
  } else {
    pararGravacaoVozIA();
  }
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

    const modal = document.getElementById('modalVozIA');
    const icone = document.getElementById('iconeVozIA');
    const titulo = document.getElementById('tituloVozIA');
    const subtitulo = document.getElementById('subtituloVozIA');
    const btnAcao = document.getElementById('btnAcaoVozIA');
    const caixaLive = document.getElementById('caixaAnaliseLive');

    if (modal) modal.style.display = 'block';
    if (caixaLive) caixaLive.style.display = 'none';
    if (icone) icone.classList.add('gravando');
    if (titulo) titulo.innerText = "Escutando seu relato...";
    if (subtitulo) subtitulo.innerText = "Fale o tipo de incidente e OBRIGATORIAMENTE o bairro/local.";
    if (btnAcao) {
      btnAcao.innerText = "⏹️ Finalizar";
      btnAcao.style.display = 'block';
    }

  } catch (err) {
    console.error("Erro de microfone:", err);
    alert("Permissão de microfone negada ou não encontrada.");
  }
}

function pararGravacaoVozIA() {
  if (mediaRecorderIA && gravandoIA) {
    mediaRecorderIA.stop();
    mediaRecorderIA.stream.getTracks().forEach(track => track.stop());
    gravandoIA = false;

    const icone = document.getElementById('iconeVozIA');
    const titulo = document.getElementById('tituloVozIA');
    const subtitulo = document.getElementById('subtituloVozIA');
    const btnAcao = document.getElementById('btnAcaoVozIA');

    if (icone) icone.classList.remove('gravando');
    if (titulo) titulo.innerText = "✨ Processando relato...";
    if (subtitulo) subtitulo.innerText = "Iniciando comunicação com a inteligência artificial...";
    if (btnAcao) btnAcao.style.display = 'none';
  }
}

function converterBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function processarAudioComGemini(base64Audio, mimeType) {
  const promptSistema = `
    Você é a IA de triagem de segurança comunitária do Alerta Bairro em Manaus.
    Escute o áudio e extraia estritamente um JSON no seguinte formato:
    {
      "tipo": "Roubo" | "Falta de Luz" | "Alagamento" | "Acidente de Trânsito" | "Desaparecimento" | "Incêndio",
      "descricao": "resumo claro do ocorrido baseado na fala",
      "bairro_mencionado": "nome do bairro ou rua em Manaus se foi falado explicitamente no áudio, ou null se NÃO foi informado o local"
    }
    Atenção: Se o usuário não disser o nome do bairro, rua ou ponto de referência, defina "bairro_mencionado" estritamente como null.
    Responda APENAS o JSON puro, sem marcações markdown.
  `;

  const caixaLive = document.getElementById('caixaAnaliseLive');
  const textoLive = document.getElementById('textoAnaliseLive');

  if (caixaLive) caixaLive.style.display = 'block';

  try {
    // Etapa 1: Imersão visual
    if (textoLive) textoLive.innerText = "🎙️ Analisando áudio enviado...";
    await new Promise(r => setTimeout(r, 600));

    // Etapa 2: Requisição à IA
    if (textoLive) textoLive.innerText = "🧠 Identificando tipo de ocorrência e localização...";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: mimeType.split(';')[0], data: base64Audio } },
            { text: promptSistema }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || "Erro no servidor Gemini");
    }

    const textoResposta = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonLimpo = textoResposta.replace(/```json/g, '').replace(/```/g, '').trim();
    const dadosOcorrencia = JSON.parse(jsonLimpo);

    // Validação de bairro: Se não falou onde foi, descarta a criação e avisa
    if (!dadosOcorrencia.bairro_mencionado || dadosOcorrencia.bairro_mencionado === "null") {
      if (textoLive) textoLive.innerText = "⚠️ Localização não identificada no seu áudio.";
      showToast("Por favor, informe o bairro ou local da ocorrência ao gravar o relato.", "error", 4500);
      setTimeout(() => { fecharModalVozIA(); }, 2500);
      return;
    }

    // Etapa 3: Mapeamento Geográfico no OpenStreetMap
    if (textoLive) textoLive.innerText = `📍 Localizando "${dadosOcorrencia.bairro_mencionado}" no mapa de Manaus...`;
    
    const geoLocal = await buscarCoordenadasBairroManaus(dadosOcorrencia.bairro_mencionado);

    if (!geoLocal) {
      if (textoLive) textoLive.innerText = "⚠️ Bairro não encontrado na região.";
      showToast(`Não localizamos "${dadosOcorrencia.bairro_mencionado}" em Manaus. Tente citar o bairro novamente.`, "error", 4500);
      setTimeout(() => { fecharModalVozIA(); }, 2500);
      return;
    }

    // Etapa 4: Exibição da transcrição digitada
    if (textoLive) textoLive.innerText = "✨ Finalizando registro do alerta...";

    const resumoVisual = `🚨 Tipo: ${dadosOcorrencia.tipo}\n📍 Local: ${geoLocal.nomeOficial}\n📝 Relato: "${dadosOcorrencia.descricao}"`;
    await digitarTextoEfeito(resumoVisual, textoLive, 15);

    setTimeout(async () => {
      await cadastrarAlertaGeradoPorIA({
        tipo: dadosOcorrencia.tipo,
        descricao: dadosOcorrencia.descricao,
        bairro: geoLocal.nomeOficial,
        lat: geoLocal.lat,
        lng: geoLocal.lng
      });
      if (caixaLive) caixaLive.style.display = 'none';
    }, 1200);

  } catch (error) {
    console.error("Erro na integração com Gemini:", error);
    const mensagemHumana = obterMensagemErroAmigavel(error);
    
    if (textoLive) textoLive.innerText = `❌ ${mensagemHumana}`;
    showToast(mensagemHumana, "error", 4000);
    
    setTimeout(() => { fecharModalVozIA(); }, 3000);
  }
}

async function cadastrarAlertaGeradoPorIA(dados) {
  const novoAlerta = {
    tipo: dados.tipo || "Outro",
    bairro: dados.bairro,
    descricao: `[Relato por Voz IA] ${dados.descricao}`,
    lat: dados.lat,
    lng: dados.lng,
    data: firebase.firestore.FieldValue.serverTimestamp(),
    contemAnexo: false,
    urlAnexo: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150',
    criadoPorIA: true
  };

  db.collection("alertas").add(novoAlerta).then(() => {
    fecharModalVozIA();
    showToast(`🚨 Alerta em ${novoAlerta.bairro} publicado no mapa!`, 'success');
    mapa.flyTo([dados.lat, dados.lng], 16, { animate: true });
  }).catch((err) => {
    console.error("Erro ao salvar alerta:", err);
    showToast("Erro ao registrar o alerta no banco de dados.", "error");
    fecharModalVozIA();
  });
}

function fecharModalVozIA() {
  const modal = document.getElementById('modalVozIA');
  if (modal) modal.style.display = 'none';
}