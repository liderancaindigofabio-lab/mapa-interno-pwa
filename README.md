# Mapa Interno — protótipo

Aplicativo web progressivo (PWA) para desenhar um mapa esquemático de percursos internos por pavimento. É um protótipo de uso pessoal: ainda não tem planta do local, posicionamento absoluto ou orientação confiável de navegação.

## O que já funciona

- Registra passos estimados pelo acelerômetro, quando o aparelho e o navegador permitem; há também um botão para registrar passos manualmente.
- Converte passos em deslocamento aproximado (0,65 m por passo) em um mapa esquemático.
- Acompanha giros pela orientação do celular quando o sensor está disponível; botões permitem corrigir curvas de 90 graus. Também registra subida/descida, desfaz o último movimento e pausa/finaliza.
- Permite desenhar áreas fechadas marcando seus vértices no mapa e dando nome e cor, além de salvar pontos individuais.
- Toque no mapa para corrigir a posição atual; pontos nomeados com cores para marcar locais.
- Três pavimentos genéricos, com posição aproximada mantida ao trocar de nível.
- Guarda os dados apenas no armazenamento local do navegador; permite exportar e importar cópia JSON.
- Interface responsiva e cache para abertura offline depois da primeira visita.

## Limitações importantes

- A direção inicial é relativa ao início do percurso. O sensor pode acompanhar giros, mas pode falhar ou variar com a posição do celular; faça o teste no aparelho e use os botões para corrigir. Não usa GPS interno, Wi-Fi, Bluetooth, câmera ou beacons.
- A detecção de passos pode contar passos a mais ou a menos; distância, forma e escala do desenho são aproximadas. Use o toque no mapa para corrigir.
- Os pavimentos aparecem como “Pavimento 1, 2 e 3”; ainda não há editor para renomeá-los nem planta real do local.
- Não calcula caminho até um destino ainda e não deve ser usado como orientação clínica, operacional, de evacuação ou emergência.
- Os dados ficam no navegador/aparelho atual. Limpar dados do navegador pode apagá-los; faça exportação de segurança.

## Como testar

1. Abra `index.html` em um navegador para testar controles e mapa; sem HTTPS/localhost, o navegador pode bloquear sensores e instalação PWA.
2. Para usar sensores e instalar como app, publique em hospedagem HTTPS autorizada ou rode um servidor local. O navegador pedirá permissão de movimento quando o percurso começar.
3. Pressione “Começar percurso”, caminhe com o celular, registre curvas e mudanças de pavimento. Se o passo automático falhar, use “Registrar passo”; toque no mapa para corrigir.
4. Use “Marcar local” para nomear áreas. Exporte JSON para manter uma cópia.

## Privacidade e segurança

O app não envia dados para um servidor e não grava áudio, vídeo, nomes de pacientes ou informações clínicas. Antes de mapear qualquer hospital, confirme autorização institucional e restrinja o mapa às áreas que você pode registrar. Não use o aparelho enquanto realiza atendimento ou em deslocamento inseguro.
