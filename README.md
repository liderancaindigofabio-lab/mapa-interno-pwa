# Mapa Interno — protótipo

Aplicativo web progressivo (PWA) para desenhar um mapa esquemático de percursos internos por pavimento. Ainda não contém planta do local, posicionamento absoluto ou roteamento automático até destinos.

## O que já funciona

- Por padrão, só registra passos quando a pessoa toca no botão. A estimativa pelo acelerômetro é opcional e vem desligada, para evitar que mexer no telefone conte como caminhada.
- Converte passos em deslocamento aproximado e permite calibrar a distância por passo com a distância medida e a contagem real de passos.
- Acompanha giros pela orientação do celular quando o sensor está disponível; botões permitem corrigir curvas. Também registra mudanças de pavimento.
- Permite desenhar áreas fechadas tocando os vértices, dar nome e cor, além de salvar pontos individuais.
- Tela cheia com arrastar, pinça de zoom, centralização na posição e acesso aos pontos salvos.
- O mapa, as áreas e as posições ficam no armazenamento local do navegador; permite exportar/importar JSON.
- O botão “Limpar traçado de teste” apaga os percursos e a contagem, preservando os pontos/áreas salvos.

## Limitações importantes

- O caminho é uma representação aproximada em uma grade. A precisão depende da calibração e de correções manuais; sensores de passo e direção podem variar por aparelho.
- A direção inicial é relativa ao início do percurso; o app não usa GPS interno, Wi-Fi, Bluetooth, câmera nem beacons.
- Os pavimentos aparecem como “Pavimento 1, 2 e 3”; não há editor para renomeá-los nem planta real do local.
- Ainda não calcula caminho até um destino e não deve ser usado como orientação clínica, operacional, de evacuação ou emergência.
- Dados ficam no navegador/aparelho atual. Limpar os dados do navegador pode apagá-los; exporte uma cópia de segurança.

## Como usar

1. Abra o app em HTTPS/Chrome no Android. Para instalar, use “Instalar aplicativo” ou o menu do navegador.
2. Para calibrar, escolha um corredor reto de distância conhecida (de preferência 10 m ou mais), caminhe contando seus passos, toque em “Calibrar passada” e informe distância e número de passos.
3. Deixe “Estimar passos automaticamente” desligado no começo. Durante o percurso, toque em “Registrar passo” a cada passo; vire o telefone junto com o corpo e use os botões de direção se o indicador não acompanhar.
4. Use “Desenhar área” e toque nos cantos do contorno; finalize com nome e cor. “Tela cheia” abre o mapa para passear, arrastar e dar zoom. “Minha posição” centraliza novamente; “Ver” em um ponto salvo abre aquele local.
5. Se o percurso de teste ficou errado, “Limpar traçado de teste” apaga apenas o traçado e a contagem, mantendo áreas e pontos.

## Privacidade e segurança

O app não envia dados para servidor e não grava áudio, vídeo, nomes de pacientes ou informações clínicas. Antes de mapear um hospital, confirme autorização institucional e restrinja o mapeamento às áreas permitidas. Não use o aparelho enquanto realiza atendimento ou em deslocamento inseguro.
