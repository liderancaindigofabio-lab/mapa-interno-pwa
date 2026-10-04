# App Android nativo

O app Android empacota a interface web localmente no APK e conecta os controles ao `SensorManager` do Android. Não depende de conexão, Google Maps ou serviço pago para contar passos e desenhar o mapa esquemático.

## Sensores e privacidade

- Usa `TYPE_STEP_DETECTOR` para receber eventos de passos; se o aparelho não oferecer esse sensor, tenta `TYPE_STEP_COUNTER`, que pode atualizar com atraso.
- Usa `TYPE_ROTATION_VECTOR` para estimar a orientação do telefone. Campos magnéticos e a forma de segurar o aparelho podem afetar o rumo.
- A permissão `ACTIVITY_RECOGNITION` é solicitada ao começar um percurso automático. Os dados são enviados só da ponte interna do WebView ao app e permanecem no armazenamento local.
- O WebView carrega arquivos locais do APK em uma origem dedicada, bloqueia navegação e recursos de outros domínios e expõe somente as funções necessárias de sensor e cópia JSON.

## Compilação de teste

O workflow `../.github/workflows/build-android.yml` cria um APK debug em cada alteração relevante. O APK debug pode ser instalado para teste, mas não tem uma chave de distribuição permanente. Faça exportação JSON antes de substituir/desinstalar versões de teste.

Para migrar do PWA, exporte `meu-mapa-interno.json` no navegador e importe esse arquivo pelo app Android. Cada instalação mantém seu próprio armazenamento local.
