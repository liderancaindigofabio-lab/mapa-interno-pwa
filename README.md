# Mapa Interno — HUSE (protótipo)

Aplicativo pessoal para registrar percursos e construir um mapa esquemático por pavimento. Há duas formas de uso: o PWA publicado e um aplicativo Android nativo que usa os sensores de passos do aparelho.

## Versões

- **PWA:** [abrir no navegador](https://liderancaindigofabio-lab.github.io/mapa-interno-pwa/). A contagem manual é o padrão; a estimativa por acelerômetro é experimental e pode confundir movimentos do telefone com passos.
- **Android nativo:** o projeto-fonte fica em `android/`. Usa o sensor nativo Step Detector quando disponível (ou Step Counter como alternativa), com permissão de atividade física do Android. A contagem automática é ativada por padrão no primeiro uso se o aparelho disponibilizar o sensor. A bússola usa o vetor de rotação do Android.

## Precisão e limitações

- O sensor nativo pode melhorar a contagem de passos, mas não mede a posição exata no corredor. A posição continua sendo estimada pela distância por passo e direção; o erro pode se acumular ao longo do percurso.
- Calibre a passada em um trecho reto medido e mantenha o telefone em posição estável, apontado na direção da caminhada. Interferência magnética no hospital pode desviar a orientação.
- GPS não fornece planta interna precisa. O protótipo não recebe planta do HUSE, não usa localização Wi-Fi/Bluetooth/UWB e não calcula rotas até destinos. Para precisão maior, é necessário um mapa autorizado e referências conhecidas ao longo do percurso (por exemplo, pontos fixos ou beacons instalados e aprovados).
- A tela oferece três pavimentos genéricos; não foram conferidos com a planta oficial do HUSE.

## Dados e migração

O mapa é guardado localmente no navegador ou no armazenamento do app Android; não é enviado a um servidor. O armazenamento do app Android é separado do PWA. Para migrar: exporte o JSON no PWA, transfira o arquivo ao telefone e importe-o no app Android. Exporte cópias de segurança antes de desinstalar ou limpar dados.

## Segurança e uso

O APK não precisa de Google Maps nem de serviços pagos. A permissão de atividade física é usada para a contagem de passos; não é enviado dado de movimento a terceiros. Confirme autorização institucional antes de mapear áreas do hospital, não registre dados de pacientes e não use o telefone durante atendimento, em área restrita ou em deslocamento inseguro. O protótipo não serve para orientação clínica, operacional, de evacuação ou emergência.

## Construção do APK

O fluxo em `.github/workflows/build-android.yml` compila o app Android e publica um APK de teste como artefato do GitHub Actions. A assinatura de depuração serve para teste no aparelho; antes de distribuir atualizações permanentes, configure uma chave privada de assinatura protegida fora do repositório.
