 Alerta Bairro

O Alerta Bairro é uma plataforma web colaborativa focada na segurança e infraestrutura urbana de Manaus. O sistema permite que os moradores relatem ocorrências em tempo real (como alagamentos, falta de luz ou roubos) e visualizem esses dados em um mapa interativo.

 Funcionalidades

° Mapa Interativo (Smart Map): Renderização de ocorrências em tempo real utilizando Leaflet.js.
° Radar de Segurança:** Alertas de proximidade baseados na localização do usuário.
° Triagem com Inteligência Artificial (Em breve):** Integração com a API do Google Gemini para classificar a gravidade dos relatos e filtrar automaticamente mensagens falsas ou trotes.
° PWA Mobile-Ready (Em breve):** Arquitetura híbrida pronta para encapsulamento mobile.

 Tecnologias Utilizadas

Este projeto foi construído focando em performance, sem a dependência de frameworks pesados no front-end, garantindo um MVP leve e de rápida execução.

*   Front-end: HTML5, CSS3, JavaScript (Vanilla)
*   Mapas: Leaflet.js
*   Banco de Dados: Firebase (Realtime Database)
*   Inteligência Artificial: Google Gemini API (LLM para NLP)
*   DevOps: GitHub Actions (CI/CD Pipeline)


*ATUALIZAÇÃO 06/09/2026*

# 🚨 Alerta Bairro

> Uma aplicação web colaborativa de monitoramento e segurança comunitária em tempo real, projetada para mapear incidentes urbanos, rastrear perímetros geográficos e facilitar a comunicação rápida entre moradores[cite: 3, 4, 5].

## 📖 Sobre o Projeto
O **Alerta Bairro** é um sistema front-end imersivo desenvolvido para fortalecer a segurança de comunidades urbanas (tendo como referência geográfica inicial a cidade de Manaus)[cite: 3, 5]. A plataforma resolve o problema da fragmentação de informações sobre ocorrências locais, centralizando alertas de segurança, infraestrutura e emergências em um único ambiente digital interativo, acessível tanto via desktop quanto por dispositivos móveis[cite: 3, 4, 5].

## 🛠️ Stack Tecnológica e Infraestrutura
A arquitetura do projeto foi construída com foco em desempenho, leveza e comunicação em tempo real, sem dependência de frameworks complexos de front-end:

* **Front-end:** Desenvolvido em HTML5 estruturado[cite: 3], CSS3 estilizado com variáveis customizadas para paletas regionais[cite: 4], e Vanilla JavaScript (ES6+) modularizado[cite: 5].
* **Mapeamento e Georreferenciamento:** Biblioteca **Leaflet.js** integrada com camadas de tiles do OpenStreetMap para renderização vetorial de mapas[cite: 3, 5].
* **Banco de Dados e Nuvem:** **Firebase Firestore** (v10.11.1) para persistência e sincronização de dados de ocorrências em tempo real[cite: 3, 5].
* **Autenticação:** **Firebase Auth** configurado com suporte a autenticação por e-mail/senha e login social integrado via `GoogleAuthProvider`[cite: 3, 5].
* **Geocodificação Reversa:** Integração assídua com a API pública do **Nominatim (OpenStreetMap)** para conversão automática de coordenadas geográficas (latitude e longitude) em nomes descritivos de bairros[cite: 5].

## 🗺️ O Mapa Interativo e Sistema de Criação de Alertas
O núcleo operacional da plataforma reside em seu mapa interativo centrado nas coordenadas padrão de Manaus (`[-3.1190, -60.0217]`)[cite: 5]. A dinâmica de registro de ocorrências comporta múltiplas interações espaciais:

* **Clique Direto no Mapa:** Ao interagir com qualquer ponto ou rua do mapa, o sistema valida a sessão do usuário[cite: 5]. Se autenticado, um pop-up flutuante dinâmico é renderizado instantaneamente com um formulário compacto de cadastro[cite: 5].
* **Geocodificação Automática:** Por meio da função `detectarBairro()`, as coordenadas do clique acionam consultas reversas ao Nominatim para preencher de forma inteligente o campo de bairro correspondente[cite: 5].
* **Modal Expandido ("Criar Alerta Completo"):** Um painel modal robusto acessível por botão flutuante dedicado permite classificar incidentes em categorias avançadas, tais como Roubo, Falta de Luz, Alagamento, Acidente de Trânsito e Desaparecimento[cite: 3, 5].
* **Anexos de Evidências Visuais:** Para ocorrências críticas como "Desaparecimento", o sistema exibe dinamicamente um bloco de upload de arquivos[cite: 3, 5]. As mídias locais são processadas via `FileReader` para pré-visualização instantânea na interface e armazenamento estruturado no Firestore[cite: 5].

## 🔍 Sistema de Filtragem e Listagem de Atividades
A interface conta com um painel escuro minimalista fixado na lateral esquerda da tela, alimentado por um listener em tempo real (`onSnapshot`) conectado à coleção de alertas do Firestore[cite: 3, 5].

* **Filtros por Categoria:** Os botões de navegação rápida superior ("🔍 Todos", "🛑 Roubos", "💡 Falta de Luz", "🌊 Alagamentos") realizam filtragens instantâneas que atualizam simultaneamente a listagem textual e os marcadores visuais no Leaflet[cite: 3, 5].
* **Miniaturas e Visualizador Global:** Cards de ocorrências que contêm evidências fotográficas exibem miniaturas interativas[cite: 3, 5]. Ao clicar em qualquer imagem, o sistema abre um modal global em tela cheia (`#modal-imagem-global`) para inspeção detalhada do arquivo[cite: 3, 5].

## 📡 Sonar Comunitário (Radar de Proximidade)
O módulo de radar transforma o dispositivo do usuário em uma ferramenta ativa de monitoramento perimétrico utilizando a API nativa `navigator.geolocation.watchPosition`[cite: 5].

* **Perímetro de Cobertura de 500m:** Desenha dinamicamente um círculo geográfico (`circuloRadar`) ao redor da posição atual do usuário (`marcadorUsuario`)[cite: 5].
* **Cálculo Avançado de Perigo:** A função `calcularNivelPerigo()` mede a distância métrica exata entre o usuário e todas as ocorrências ativas, categorizando o risco em três níveis distintos[cite: 5]:
  * **Nível 0 (Perímetro Seguro):** Ausência de incidentes relevantes na vizinhança imediata[cite: 5].
  * **Nível 1 (Ameaça Detectada):** Presença de alertas moderados dentro do raio estipulado[cite: 5].
  * **Nível 2 (Perímetro em Alerta):** Alta densidade de ocorrências críticas ou incidência de crimes de alto impacto (como roubos) a menos de 500 metros, disparando animações visuais de pulsação no radar[cite: 5].

## 👤 Sistema de Autenticação e Perfil do Usuário
A plataforma adapta seu comportamento visual e de permissões de acordo com o estado da sessão:

* **Página de Boas-Vindas (Landing Page):** Exibida por padrão a visitantes não autenticados, oferecendo seções descritivas, métricas de cobertura, carrosséis de feed comunitário recente e blocos explicativos de recursos[cite: 3, 5].
* **Modal de Acesso Centralizado:** Interface limpa para autenticação via e-mail e senha, criação de novas contas, recuperação de credenciais e login federado com o Google[cite: 3, 5].
* **Menu Flutuante de Perfil:** Uma gaveta lateral moderna acessível após o login que exibe o avatar do usuário (`photoURL`), nome completo, e-mail, opções de configuração da conta, chaves de preferência para notificações push do sonar e a ação de encerramento de sessão (`sair()`)[cite: 3, 5].

## 📊 Mapeamento de Calor Dinâmico (Áreas Críticas)
Além dos marcadores individuais de ocorrências, o sistema executa a rotina `gerarMapaDeCalorDinamico()`, que agrupa incidentes próximos (dentro de um raio de 400 metros)[cite: 5]. O algoritmo calcula a concentração de registros e projeta círculos translúcidos com marcações estatísticas (`📊`) sobre as zonas mais afetadas da cidade, oferecendo uma visão macro de segurança urbana[cite: 5].

## 🚀 Próximos Passos e Roadmap
* [ ] **Versão PWA (Progressive Web App):** Conversão estrutural para aplicativo híbrido instalável diretamente em plataformas mobile.
* [ ] **Triagem por Inteligência Artificial (Gemini API):** Implementação de assistente inteligente por comando de voz para transcrição, categorização e filtragem automática de chamados de emergência.
