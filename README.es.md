# Agents City

[Español](README.es.md) · [English](README.md)

**Ejecuta varias ciudades autónomas de agentes en una máquina y conecta sólo
las que deban hablar.**

```bash
npm install -g agents-city
agents-city
```

Esa es toda la instalación. El segundo comando abre el ayuntamiento en tu
navegador y te acompaña a crear tu primera ciudad.

Agents City es un orquestador local y multimodelo para trabajo con repositorios.
Cada ciudad tiene una identidad, un dominio, un asiento principal, un objetivo,
agentes de apoyo por repo, conocimiento editable, skills reconocidas en vivo y
carreteras explícitas hacia otras ciudades. No convierte todos los agentes en un
chat grupal: el asiento preside, selecciona a los especialistas y controla los
turnos.

Esta es la guía completa. Si sólo quieres probarlo, ve a [Inicio rápido](#inicio-rápido).

## Índice

- [Modelo mental](#modelo-mental)
- [Inicio rápido](#inicio-rápido)
- [Requisitos e instalación](#requisitos-e-instalación)
- [Primer arranque, paso a paso](#primer-arranque-paso-a-paso)
- [Trabajar dentro de tmux](#trabajar-dentro-de-tmux)
- [Motores y transportes](#motores-y-transportes)
- [Dominios, roles y conocimiento](#dominios-roles-y-conocimiento)
- [Referencia completa de comandos](#referencia-completa-de-comandos)
- [Comité: flujo completo](#comité-flujo-completo)
- [Comandos `/city:` de Claude](#comandos-city-de-claude)
- [Recetario de casos de uso](#recetario-de-casos-de-uso)
- [Ficheros y variables de entorno](#ficheros-y-variables-de-entorno)
- [Seguridad y límites de confianza](#seguridad-y-límites-de-confianza)
- [Resolución de problemas](#resolución-de-problemas)
- [Desarrollo y pruebas](#desarrollo-y-pruebas)

## Modelo mental

Una ciudad no es una cuenta, una persona remota ni un conjunto libre de bots. Es
un ámbito de trabajo autónomo propiedad de una persona local:

```text
usuario local
├── ciudad home
│   ├── identidad estable: propietario/home
│   ├── dominio + rol del asiento + objetivo
│   ├── asiento: presidente y única frontera pública
│   ├── agente A: workspace + montajes → un repo git (tipo: code)
│   ├── agente B: workspace + montajes → una carpeta de documentos (tipo: knowledge)
│   ├── agente C: workspace + montajes → varios repos y un worktree
│   ├── conocimiento de dominio/rol editable
│   ├── skills que ya existen dentro del trabajo montado
│   └── carreteras explícitas hacia otros asientos
├── ciudad producto
└── ciudad cliente-a
```

**Primero vienen los agentes.** La unidad es el agente, y un repo es solo una de
las cosas que puede montar. Cada agente tiene una **carpeta de trabajo** con un
directorio `mounts/` de symlinks a donde vive el trabajo real — un repo git, un
worktree enlazado o una simple carpeta de documentos — así que una persona cuyo
trabajo es conocimiento en documentos, sin git alguno, es un agente de primera
clase. «Un repo es un agente» es solo el caso particular de un agente cuyo único
montaje es ese repo, por lo que **las ciudades de solo-repos siguen funcionando
igual**. Modelo completo: [docs/agents-first.md](docs/agents-first.md).

Las fronteras importantes son:

- **Usuario:** puede poseer varias ciudades locales.
- **Ciudad:** tiene identidad, dominio, objetivo, configuración y estado propios.
- **Asiento (`seat`):** es el presidente del comité y el único actor que puede
  cruzar carreteras.
- **Agente:** la unidad miembro. Posee una carpeta de trabajo y opera sobre sus
  montajes, aporta evidencia y siempre tiene autoridad de miembro — sea su
  especialidad `dev`, `seo` o `cfo`, y sea su **tipo** `code`, `knowledge` o
  `coordinator`.
- **Montaje:** un symlink dentro de la carpeta de un agente hacia trabajo real en
  disco (un repo, un worktree, una carpeta de documentos). Un agente puede tener
  varios, o ninguno.
- **Rol:** perspectiva y responsabilidad profesional; no concede permisos del bus.
- **Skill:** capacidad instalada por el usuario o el propio repo. El
  reconocimiento es en vivo y de solo lectura; la única escritura deliberada es
  el Hall instalando un zip de skill que el dueño sube explícitamente, en el
  hogar de ese agente — nunca por su cuenta, nunca en otro sitio. Las skills
  son el formato del runtime de Claude; los demás motores las ignoran.
- **Carretera:** allowlist entre dos asientos. Da alcance, no autoridad.
- **Comité:** proceso acotado de posiciones aisladas, síntesis, palabra, decisión
  y verificación. No es una conversación lateral entre todos.

## Inicio rápido

### Instalar desde npm

```bash
npm install -g agents-city
agents-city --version
```

Esto es `0.x` a propósito: los comandos ya se usan hoy, pero los formatos de
fichero y las APIs todavía pueden cambiar entre versiones menores. Aquí nada
pretende estar congelado.

Necesitas Node.js 22 o superior, Python 3 y tmux; los detalles están en la
[tabla de requisitos](#requisitos-base), y `agents-city seat` se ofrece a
instalar tmux si falta. No se instala nada en el sistema más allá de la carpeta
global de npm de tu Node activo.

### Probarlo sin instalar nada

```bash
npx agents-city
```

`npx` descarga el paquete en su caché, lo ejecuta y deja intacta tu carpeta
global de npm — la forma más rápida de ver si esto es para ti.

### Después: el Hall, o el terminal

```bash
agents-city        # el ayuntamiento en el navegador (igual que: agents-city hall)
agents-city seat   # el asistente en terminal, si prefieres no salir de la shell
```

El Hall se sirve en `127.0.0.1`, elige un puerto libre y abre el navegador. Allí
puedes crear o seleccionar una ciudad, editar su configuración, ajustar el motor
de cada agente y ver el mapa en vivo. El Hall y el CLI usan los mismos módulos
por debajo, así que ninguno de los dos es el camino "menor".

### Actualizar o quitar

```bash
npm install -g agents-city        # actualizar a la última versión
npm uninstall -g agents-city      # quitar el programa
```

Desinstalar deja `~/.agents-city`, tus ciudades y tus repos exactamente donde
están: el programa no son tus datos.

### Instalar desde el código fuente

Para quien contribuye, y para quien quiera leer el código antes de ejecutarlo.
Empaquetar primero es la prueba honesta: ejercita exactamente la lista de
ficheros que recibe una persona desde npm, no tu copia de trabajo entera.

```bash
git clone https://github.com/jlcases/agents-city.git
cd agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city --version
```

## Requisitos e instalación

### Requisitos base

| Requisito | Para qué se usa |
|---|---|
| Node.js 22 o posterior | paquete npm, bus WebSocket y frontends |
| npm | instalación y empaquetado |
| Python 3 | Hall, onboarding, ciudades, mapas y utilidades |
| bash | sesiones y launchers |
| tmux | una ventana por asiento/repo; `seat` intenta instalarlo si falta |
| macOS o Linux | plataformas nativas soportadas |
| WSL | necesario en Windows porque Windows no incluye bash/tmux nativos |

Cada motor necesita además su propio CLI instalado y autenticado. Agents City no
incluye ni suplanta las cuentas de Claude, Codex, OpenCode o Kimi.

```bash
command -v claude
command -v codex
command -v opencode
command -v kimi
```

No necesitas tenerlos todos. Puedes usar sólo Claude, sólo Codex o una mezcla.

### GitHub es opcional

Elegir repos locales no necesita cuenta. Si durante el onboarding eliges GitHub,
Agents City usa el CLI independiente `gh`:

1. lo detecta;
2. intenta instalarlo con el gestor del sistema si falta;
3. ejecuta `gh auth login --web` si no está autenticado;
4. muestra el código de dispositivo si no puede abrir el navegador;
5. ofrece clonar los repos seleccionados que aún no estén en el disco.

`gh` no va dentro del paquete npm de Agents City.

### Actualizar una instalación

```bash
npm install -g agents-city        # desde el registro
agents-city --version
```

Desde un checkout del código, empaqueta e instala el tarball:

```bash
cd /ruta/al/checkout/agents-city && npm pack && npm install -g ./agents-city-*.tgz
```

Las sesiones ya abiertas conservan el código cargado en memoria. Para aplicar la
nueva versión a una ciudad:

```bash
agents-city exit home --dry-run
agents-city exit home
agents-city seat --city home
```

Guarda primero cualquier trabajo activo: `exit` cierra todas las ventanas de esa
ciudad.

### Desinstalar

```bash
npm uninstall -g agents-city
```

Esto elimina el programa instalado, pero **no** borra `~/.agents-city`, tus
ciudades, backups ni repos. Usa `agents-city reset` sólo cuando quieras reiniciar
una ciudad concreta.

## Primer arranque, paso a paso

`agents-city seat` crea `home` si todavía no existe y hace siete preguntas.

### 1. Dominio de trabajo

El dominio determina vocabulario, criterios de evidencia y roles sugeridos. Las
opciones incorporadas son:

| ID | Dominio |
|---|---|
| `software` | Desarrollo de software |
| `healthcare` | Salud y medicina |
| `legal` | Servicios legales |
| `finance` | Finanzas y operaciones |
| `marketing` | Marketing y crecimiento |
| `sales` | Ventas y customer success |
| `research` | Investigación y educación |
| `operations` | Operaciones y delivery |
| `custom` | Otro dominio, sin suponer una industria |

### 2. Rol del asiento

Es la responsabilidad del jefe de esa ciudad, no el nombre de la ciudad ni el
motor. El asiento sigue siendo presidente aunque elijas `blank`.

### 3. Los agentes, de uno en uno

Esta es la ciudad en sí, y es un bucle, no una lista de carpetas que marcar. Cada
agente se pregunta entero, y después se te ofrece otro, hasta que digas que la
ciudad está completa:

1. **Su nombre** — cómo lo llamas en su ventana, en el mapa y en el bus.
2. **Qué tipo de trabajo hace** — `code`, `knowledge` o `coordinator`. No es un
   permiso: decide cómo crece su casa en el mapa, para que a quien trabaja con
   documentos no se le mida en pull requests.
3. **Su rol** — su especialidad, del dominio de esta ciudad o de otro. Una ciudad
   de software puede dar `po` a un agente de producto, `seo` al del portfolio y
   `data-engineer` al del pipeline. Ninguno se convierte en presidente.
4. **Todo aquello sobre lo que trabaja** — cuantos repos quiera (leídos del
   disco, de tu cuenta GitHub o de una organización) **más** cuantas carpetas de
   documentos quiera. Un agente puede responder por tres servicios y un manual a
   la vez, y un agente sin git en ninguna parte es un agente de primera. Todo se
   monta dentro de su workspace, no se convierte en agentes distintos.
5. **Qué lo ejecuta** — Claude con su propio modelo y esfuerzo, o Codex,
   OpenCode, Kimi, o un fallback explícito de terminal.
6. **Las skills con las que empieza** — una carpeta de skill o un `.zip`
   instalado en la casa de ese agente. Sólo se ofrece para motores que leen
   skills: a un agente en Codex se le dice que su motor las ignora, en vez de
   venderle algo que no hace nada.

Cada agente recibe entonces una ventana tmux, un actor privado del bus, su
workspace como directorio de trabajo y las skills que su runtime ya sea capaz de
descubrir en lo que monta.

Decir que la ciudad no tiene agentes también es válido: abre con sólo su asiento,
y las carreteras la conectan con otras ciudades.

Cambia el reparto cuando quieras con `agents-city seat --agents`.

### 4. Objetivo

Un objetivo puede ser cuantitativo o cualitativo. Guarda:

- título;
- señal observada;
- comando que devuelve la medida, si existe;
- persona y frecuencia de juicio, si es cualitativo;
- baseline;
- target;
- fecha objetivo.

Puedes omitirlo y configurarlo después con `agents-city seat --goal`.

### 5. Motor de tu propia silla

El motor de cada agente ya se decidió sobre el agente, en la pregunta 3. Queda tu
ventana: la que sostiene el rol de presidente, los comandos `/city:` y el plugin.
Enter la deja en tu Claude; también puedes elegir Claude con modelo y esfuerzo,
Codex, OpenCode, Kimi, o un comando desconocido mediante el fallback explícito de
terminal.

La configuración persistente queda en la ficha del propietario. Los flags
`--model` y `--effort` de `seat` son overrides sólo para ese arranque.

### 6. Si tu silla pide permiso

Por ciudad, en `city.yml` como `seat_yolo`. En local el asiento son tus propias
manos en tu propia máquina, así que pedirte permiso en tu propia silla es una
elección, no una ley. Las ventanas de los agentes conservan su jaula igualmente,
y arrancar con `--no-yolo` sigue frenando toda la sesión, asiento incluido.

### 7. La ciudad en tu escritorio

Se ofrece una vez, cuando la ciudad es nueva: un acceso directo de verdad con el
nombre de la ciudad y un icono coloreado a partir de su propia identidad — un
`.app` en macOS o una entrada `.desktop` en Linux. Doble clic y la ciudad se
abre.

Ejecuta la misma línea que escribirías tú, así que es un botón etiquetado sobre
la puerta que ya existe, no una segunda forma de entrar. Añádelo o quítalo cuando
quieras:

```bash
agents-city shortcut              # esta ciudad, en tu escritorio
agents-city shortcut home --hall  # una puerta que abre el mapa en su lugar
agents-city shortcut --remove     # quitarlo otra vez
agents-city shortcut --to ~/bin   # en otro sitio que no sea el escritorio
```

**En Windows** la ciudad vive dentro de WSL, y un `~/Desktop` de WSL es el
escritorio del home de Linux: uno que nadie mira nunca. Por eso el acceso directo
se escribe en el escritorio **de Windows**, preguntándoselo a Windows en vez de
adivinarlo a partir del nombre de usuario (un escritorio redirigido a OneDrive o
a un perfil de dominio no está bajo `C:\Users\<nombre>\Desktop`). Es un `.lnk` de
verdad, construido con la propia PowerShell de Windows para que pueda llevar un
`.ico`, y arranca `wsl.exe` ejecutando el mismo comando en una shell de login. Si
no hay interoperabilidad, se escribe un `.cmd` que también se abre con doble
clic: la misma puerta, con icono genérico.

### Qué se crea

```text
~/.agents-city/
├── .runtime/                  # endpoints, colas y estado efímero del bus
├── state/                    # estado local del mapa, separado por ciudad
├── .backups/                 # migraciones antiguas
└── <propietario>/
    ├── .current                # ciudad seleccionada
    ├── .backups/              # resets recuperables del propietario
    └── <ciudad>/
        ├── city.yml            # id, nombre, slug, owner, dominio
        ├── roads.json          # carreteras permitidas
        ├── <propietario>.md    # rol, repos, roles, objetivo, motores
        ├── AGENTS.md           # cómo leer esta ciudad
        ├── domains/            # conocimiento de dominio editable
        ├── roles/              # conocimiento de roles editable
        ├── deliberations/      # estados, eventos y actas del comité
        ├── units.yml            # barrios del mapa, si se usa
        └── parcels.yml          # casas/parcelas del mapa, si se usa
```

El root `~/.agents-city` es un contenedor, nunca una ciudad. `home` es sólo la
primera ciudad y se aísla igual que `producto` o `cliente-a`.

## Trabajar dentro de tmux

Una sesión se llama `<propietario>-<ciudad>` y contiene:

- ventana `seat`: asiento principal, situado en la carpeta de la ciudad;
- una ventana por repo encontrado localmente;
- el runtime configurado ya iniciado en cada ventana.

Atajos instalados sólo en el servidor tmux actual:

| Acción | Atajo |
|---|---|
| Cambiar a las ventanas 1–9 | `Alt+1` … `Alt+9` |
| Ventana anterior/siguiente | `Alt+←` / `Alt+→` |
| Seleccionar con ratón | clic en la barra inferior |
| Scroll | rueda del ratón |
| Separarse sin cerrar | `Ctrl-b`, después `d` |
| Volver a la ciudad | `agents-city seat --city <nombre>` |

Si la sesión ya existe, `seat` se vuelve a adjuntar: no crea otra ni duplica los
agentes. Una pestaña con campana o color de actividad indica que merece atención.

Claude se inicia de forma escalonada porque varias instancias comparten su token
OAuth. Codex, OpenCode y Kimi no esperan ese escalonado. Usa `CITY_SETTLE=0
CITY_STAGGER=0` sólo si quieres desactivarlo conscientemente.

No cierres una ciudad matando procesos genéricos. Usa:

```bash
agents-city exit <ciudad> --dry-run
agents-city exit <ciudad>
```

## Motores y transportes

Todos reciben sobres del mismo bus WebSocket local, pero la última milla es
nativa para cada proveedor:

| Runtime | Entrega de tareas del bus | Interfaz visible | Requisito |
|---|---|---|---|
| Claude | `stream-json` persistente por stdin/stdout | gateway interactivo `city>` y transcripción visible de Claude | CLI `claude` autenticado; sin Team ni política admin |
| Codex | `app-server` WebSocket | TUI oficial conectada con `codex --remote` | CLI `codex` autenticado |
| OpenCode | API HTTP/SSE | consola interactiva `city>` del gateway | CLI `opencode` configurado |
| Kimi | REST + WebSocket | consola interactiva `city>` del gateway | CLI `kimi` o `kimi-code` configurado |
| CLI desconocida | adapter de compatibilidad | TUI/comando propio dentro de tmux | configuración `terminal:<comando>` |

Las tareas de Claude, Codex, OpenCode y Kimi **no** se pegan en tmux ni pasan por
el portapapeles. El fallback de terminal existe sólo para un comando desconocido
elegido explícitamente.

Agents City **no** usa Channels personalizados en el arranque normal de Claude.
El mismo proceso oficial de Claude Code permanece abierto en modo
print/streaming y recibe turnos JSONL directamente desde el gateway de la ciudad.
Por tanto, una cuenta personal Pro/Max no necesita `sudo`,
`managed-settings.json`, consola Team, allowlist de Channels, bypass de desarrollo
ni confirmaciones por ventana. El plugin instalado sigue aportando normalmente
sus herramientas MCP, skills y hooks. Los Channels personalizados quedan como un
mecanismo preview opcional de Anthropic, no como requisito de Agents City.

Ejemplo conceptual de una ficha multimodelo:

```yaml
runs.seat: codex
runs.api: codex --model gpt-5
runs.analytics: opencode -m lmstudio/qwen3-coder
runs.research: kimi
runs.legacy: terminal:gemini
model.docs: sonnet
effort.docs: high
```

Si el asiento no usa Claude, no tendrá comandos `/city:`. Todo lo fundamental
sigue disponible mediante `agents-city committee`, `road`, `bus`, `skills`,
`seat`, `reset` y `exit`.

## Dominios, roles y conocimiento

### Roles incorporados por dominio

| Dominio | IDs de rol disponibles |
|---|---|
| `software` | `cpto`, `dev`, `data-engineer`, `devops`, `data`, `product-design`, `po`, `llm-engineer`, `ai-manager`, `blank` |
| `healthcare` | `clinical-director`, `clinician`, `patient-safety`, `clinical-ops`, `health-data`, `health-compliance`, `blank` |
| `legal` | `managing-partner`, `associate`, `compliance`, `knowledge`, `ops`, `blank` |
| `finance` | `cfo`, `controller`, `fin-analytics`, `ops`, `compliance`, `blank` |
| `marketing` | `brand-lead`, `content`, `performance`, `seo`, `lifecycle`, `data`, `product-design`, `blank` |
| `sales` | `revenue-lead`, `account-executive`, `revops`, `customer-success`, `enablement`, `blank` |
| `research` | `research-director`, `researcher`, `methods`, `research-ops`, `ethics`, `knowledge`, `blank` |
| `operations` | `operations-lead`, `program-manager`, `process-owner`, `quality`, `knowledge`, `blank` |
| `custom` | `city-lead`, `specialist`, `quality`, `knowledge`, `blank` |

`blank` es una decisión completa: no crea fichero de rol, no aplica un perfil
oculto y no infiere una responsabilidad. Puede asignarse al asiento o a cualquier
repo y cambiarse más tarde.

Al seleccionar un dominio/rol, Agents City copia los packs iniciales a la ciudad:

```text
domains/<dominio>.md
roles/<rol>.md
```

Son Markdown normal. Puedes editar, quitar o ampliar su contenido. Un cambio de
rol posterior no sobrescribe un fichero existente, por lo que tus adaptaciones se
conservan. Este conocimiento no es una skill.

## Referencia completa de comandos

### Vista general

```text
agents-city [hall]
agents-city setup
agents-city seat
agents-city cities
agents-city road
agents-city connect
agents-city bus
agents-city committee
agents-city agents
agents-city skills
agents-city city
agents-city shortcut
agents-city demo
agents-city report
agents-city tokens
agents-city logs
agents-city benchmark
agents-city reset
agents-city exit
agents-city doctor
agents-city update
agents-city test
```

Comandos globales:

```bash
agents-city --help
agents-city --version
```

### `agents-city` y `agents-city hall`

Abren el Hall local de la ciudad seleccionada.

```bash
agents-city
agents-city hall
agents-city hall --city producto
agents-city hall --no-browser
```

| Opción | Efecto |
|---|---|
| `--city NAME|ID|PATH` | selecciona una ciudad conocida y abre esa |
| `--no-browser` | no abre navegador; imprime la URL local con su token temporal |

El servidor enlaza sólo `127.0.0.1` y exige un token por ejecución para cada
escritura. La columna **City live**, a la derecha, se conecta como observador al
mismo bus WebSocket local que usan los agentes. Muestra los mensajes visibles
normales de usuario/agente, fallos de runtime y todo el flujo moderado como una
conversación: un avatar por repo, el asiento marcado como presidente y un turno
visible por posición revelada o réplica concedida. Los comandos y el ruido de
ciclo de vida quedan ocultos tras **show work**; se abre por defecto la
conversación seleccionada.

El Hall abre directamente en **The map**. La ciudad ocupa todo el lienzo central: estado, controles e
historial permanecen en las barras laterales, nunca encima o debajo del mapa.
Cada turno semántico que entra por ese mismo WebSocket produce además un
bocadillo breve, anclado al personaje que habla y encabezado por su destino
(`Para seat:`, `Para committee:`, etc.). El bocadillo es sólo el resumen fugaz;
el mensaje completo y su evidencia siguen en **City live**. No se generan
diálogos de atrezo ni se muestran comandos, razonamiento privado o sobres crudos.

Codex usa los items visibles completados de app-server;
Claude, sus hooks documentados de prompt y stop. Los items de razonamiento,
chain-of-thought, credenciales y frames crudos de transporte no se muestran ni
se escriben en el registro de actividad. El token de observador rota con el hub,
sólo acepta un origen de este ordenador y es de sólo lectura: el navegador no
puede dirigir el comité. `Ctrl-c` detiene el Hall.

**Demos**, en el rail, reproduce un comité entero sin montar nada: una historia
por dominio de trabajo — un estudio, una clínica, un despacho — con play, pausa,
repetir y velocidad. Lo que reproduce son *grabaciones*: `demo/graba.py` ejecuta
cada historia sobre el bus local real, a través de la máquina de estados real del
comité, y guarda el flujo exacto de eventos que vio un espectador; el Hall los
reproduce con el mismo renderizador que usa el rail en vivo. Lo dice en pantalla,
porque una demo que finge estar en vivo es justo la que este producto no debe
publicar. Para lanzar una en vivo desde terminal: `agents-city demo --domain
software`.

Regenera las grabaciones tras editar `demo/stories.py`:

```bash
demo/graba.py            # todas las historias
demo/graba.py medicina   # sólo una
```

La suite de demo falla cuando una grabación deja de corresponderse con la
historia que dice ser, así que una obsoleta es un build en rojo y no un navegador
reproduciendo en silencio el comité del mes pasado.

Bajo la marca hay dos botones: **día/noche** e **ES/EN**. El Hall habla español e
inglés, arranca en el idioma del navegador y recuerda la elección explícita. Las
traducciones se indexan por la frase en inglés, así que lo que aún no esté
traducido cae en un inglés legible y no en un identificador — un texto nuevo
nunca se queda bloqueado esperando a la traducción.

### `agents-city setup`

Crea o selecciona una ciudad y abre el Hall; con `--tui` entrega el flujo a
`seat`.

```bash
agents-city setup
agents-city setup --city producto
agents-city setup --city producto --tui
agents-city setup --out /ruta/a/una/ciudad
agents-city setup --demo
agents-city setup --no-browser
```

| Opción | Efecto |
|---|---|
| `--city NOMBRE` | crea la ciudad gestionada si no existe o selecciona la existente |
| `--out RUTA` | registra/importa una carpeta explícita compatible; uso avanzado |
| `--demo` | abre la demo guiada completa de Aurora Games |
| `--tui` | usa onboarding de terminal y abre la sesión |
| `--no-browser` | mantiene el Hall en terminal e imprime su URL |

### `agents-city seat`

Configura lo solicitado, garantiza tmux/plugin y abre o reanuda la sesión de la
ciudad.

```bash
agents-city seat
agents-city seat --city producto
agents-city seat --repos
agents-city seat --agent-roles
agents-city seat --goal
agents-city seat --engines
agents-city seat --domain marketing
agents-city seat --domain marketing --role brand-lead
agents-city seat --role blank
agents-city seat --only api,web
agents-city seat --model sonnet --effort high
agents-city seat --seat-yolo on
agents-city seat --no-yolo --no-sync
```

| Opción | Persistencia y efecto |
|---|---|
| `--city NAME|PATH` | selecciona esta ciudad y abre su sesión |
| `--repos` | vuelve a elegir repos y luego roles de esos agentes; persiste |
| `--agent-roles`, `--agents` | vuelve a elegir sólo el rol de cada repo; persiste |
| `--goal` | vuelve a definir el objetivo; persiste |
| `--engines` | elige runtime/modelo por ventana; persiste |
| `--domain DOMINIO` | cambia dominio; persiste y pide un rol compatible si no das `--role` |
| `--role ROL` | cambia el rol del asiento sin picker; persiste |
| `--only a,b` | abre sólo esos repos en esta sesión; no cambia la ficha |
| `--model ALIAS` | override de modelo para todas las ventanas de este arranque |
| `--effort LEVEL` | override `low`, `medium`, `high`, `xhigh` o `max` para este arranque |
| `--seat-yolo on\|off` | si el propio asiento corre sin preguntar permisos; persiste por ciudad (`seat_yolo` en `city.yml`, también la sexta pregunta del asistente). En local el asiento son las manos del dueño; las ventanas de repo conservan su propia historia de yolo/jaula |
| `--no-yolo` | desactiva autoaprobación en este arranque — asiento incluido, diga lo que diga `seat_yolo` |
| `--no-sync` | no hace `git fetch/pull` inicial en repos de este arranque |

`seat` acepta un usuario posicional por compatibilidad, pero sólo si coincide con
el propietario local resuelto. Para otra ciudad del mismo usuario usa `--city`.

### `agents-city cities`

Gestiona el catálogo local. Crear o seleccionar no inicia tmux.

```bash
agents-city cities list
agents-city cities current
agents-city cities create producto
agents-city cities use producto
agents-city cities use /ruta/a/ciudad
```

| Subcomando | Salida/efecto |
|---|---|
| `list` | ciudades conocidas; `*` marca la seleccionada |
| `current` | ruta absoluta de la seleccionada |
| `create NOMBRE` | crea `~/.agents-city/<owner>/<slug>/` y la selecciona |
| `use NAME|PATH` | selecciona una ciudad existente sin arrancarla |

### `agents-city road`

Abre y cierra la allowlist de conexiones entre asientos.

```bash
agents-city road list producto
agents-city road connect producto cliente-a
agents-city road invite producto
agents-city road invite producto > producto.invitation.json
agents-city road connect producto research.invitation.json
agents-city road disconnect producto cliente-a
agents-city road disconnect producto <city-id-remoto>
```

| Subcomando | Efecto |
|---|---|
| `list CIUDAD` | muestra destino, dirección y si es local/remoto |
| `connect A B` | si B es local, escribe ambos extremos simétricamente |
| `connect A invitation.json` | añade sólo el extremo local de una carretera remota |
| `invite CIUDAD` | imprime JSON público sin token |
| `disconnect A B|ID` | elimina ambos extremos locales o el id remoto indicado |

No se puede conectar una ciudad consigo misma. Una invitación remota debe
aceptarse de forma independiente en cada máquina.

### `agents-city connect`

Empareja este ordenador con un servicio de Roads gestionadas y conecta ciudades
locales. No crea una Road de forma unilateral: las dos personas siguen
aprobando la conexión bilateral en el servicio.

```bash
agents-city connect --service https://connect.example.com
agents-city connect --city producto
agents-city connect --all
agents-city connect status
agents-city connect roads
```

El comando genera claves Ed25519/X25519 en este ordenador, muestra un PASCO de
un solo uso y abre el navegador para autorizarlo. Las claves privadas permanecen
en `~/.agents-city/.runtime/connect/` con permisos 0600/0700 y quedan selladas
para las ventanas de agentes de repositorio en macOS y Linux. Cada ciudad
conectada mantiene una sesión WSS saliente; el ordenador no abre un puerto
público. Usa `--service URL` o `AGENTS_CITY_CONNECT_URL` para un endpoint piloto.
El servidor alojado no forma parte de este repositorio Apache; el cliente y el
protocolo auditables sí.

[docs/managed-connect.md](docs/managed-connect.md) detalla el contrato de claves,
sobres, cifrado, ACK, revocación y modelo de amenazas.

### `agents-city bus`

Opera mensajes entre asientos sobre carreteras ya declaradas.

```bash
agents-city bus roster
agents-city bus inbox
agents-city bus send alice/research "Necesito confirmar el contrato del evento X"
agents-city bus send '*' "Aviso para todas mis carreteras"
```

| Subcomando | Efecto |
|---|---|
| `roster` | devuelve carreteras y presencia online conocida |
| `inbox` | devuelve y consume el siguiente lote de hasta 20; `remaining` indica lo que queda y el historial append-only permanece |
| `send owner/city TEXTO` | envía a un destino permitido |
| `send '*' TEXTO` | envía a todas las carreteras; exige al menos una |

Sólo `seat` puede ejecutar estos comandos. Un actor de repo es rechazado por la
ACL aunque conozca la dirección.

### `agents-city committee`

Gestiona deliberaciones estructuradas dentro de una ciudad. Todos los comandos
aceptan campos como flags o un objeto JSON con `--input`.

```bash
agents-city committee list
agents-city committee history
agents-city committee show <deliberation-id>
agents-city committee status <deliberation-id>   # alias de show
agents-city committee schema open
agents-city committee open --input proposal.json
agents-city committee open --input - < proposal.json
```

| Subcomando | Actor permitido | Finalidad |
|---|---|---|
| `list` | cualquiera de la ciudad | deliberaciones abiertas |
| `history` | asiento | decisiones terminadas y recuento de contribuciones |
| `show ID`, `status ID` | actor implicado | estado y eventos visibles para esa identidad |
| `schema VERBO` | cualquiera | contrato JSON de un verbo de mutación |
| `open` | asiento | formula pregunta, resultado buscado, miembros y límites |
| `respond` | miembro invitado | registra una primera posición independiente |
| `synthesize` | asiento | publica acuerdos, conflictos e incógnitas |
| `floor-request` | miembro | pide turno por evidencia, contradicción, riesgo o dependencia |
| `floor-grant` | asiento | concede una petición de palabra |
| `floor-deny` | asiento | deniega una petición con motivo |
| `reply` | miembro con turno | hace una réplica acotada y basada en evidencia |
| `decide` | asiento | fija resultado, responsables, verificador y reapertura |
| `verify` | verificador asignado | devuelve `pass` o `fail` con pruebas |
| `replan` | asiento | reabre una verificación fallida con un plan nuevo |
| `close` | asiento | cierra un resultado ya verificado |
| `cancel` | asiento | cancela una deliberación explicando el motivo |

Ejemplo de apertura mediante flags:

```bash
agents-city committee open \
  --question "¿Debemos lanzar hoy?" \
  --outcome-wanted "Una decisión reversible con dueño y verificación" \
  --context "El release candidate ha pasado las pruebas locales" \
  --constraint "No perder datos" \
  --constraint "Poder volver atrás en diez minutos" \
  --done "La decisión nombra ejecutor y verificador" \
  --authority execute \
  --member api \
  --member web \
  --member qa \
  --max-rebuttals 1
```

El resultado imprime un `deliberationId`. Guárdalo para los pasos siguientes.
Para payloads grandes es preferible JSON:

```json
{
  "question": "¿Debemos lanzar hoy?",
  "desiredOutcome": "Una decisión reversible con dueño y verificación",
  "context": "El release candidate ha pasado las pruebas locales",
  "constraints": ["No perder datos", "Rollback en diez minutos"],
  "definitionOfDone": ["Ejecutor y verificador asignados"],
  "authority": "execute",
  "participants": ["api", "web", "qa"],
  "maxRebuttals": 1
}
```

```bash
agents-city committee open --input proposal.json
```

`--input -` lee stdin. Si se mezclan JSON y flags, los flags explícitos
sobrescriben el campo equivalente. Los campos repetibles son `--member`,
`--constraint`, `--done`, `--evidence`, `--risk`, `--unknown`, `--agreement`,
`--conflict`, `--check`, `--residual-risk`, `--selected-evidence`,
`--rejected-option`, `--dissent`, `--reopen-if`, `--learning` y `--followup`.

Consulta siempre el contrato exacto disponible en la versión instalada:

```bash
agents-city committee schema respond
agents-city committee schema decide
agents-city committee schema verify
```

Los comandos de miembro (`respond`, `floor-request` y `reply`) se ejecutan
normalmente por el agente autenticado de ese repo cuando recibe el sobre. Si los
ejecutas desde el asiento, el rechazo de ACL es correcto: el bus no finge otra
identidad por aceptar un nombre como argumento.

### `agents-city skills`

Muestra las skills que ya existen en los repos de una ciudad. Es una operación
sólo de lectura: no instala, copia, activa ni elimina nada.

```bash
agents-city skills
agents-city skills producto
```

Se reconocen estos layouts por repo:

```text
SKILL.md
.claude/skills/*/SKILL.md
.codex/skills/*/SKILL.md
.agents/skills/*/SKILL.md
skills/*/SKILL.md
```

La capacidad real de invocar una skill depende del runtime. Agents City la
anuncia como capacidad del miembro y deja al proveedor aplicar sus propias reglas
de descubrimiento y uso.

### `agents-city agents`

Lista los agentes de esta ciudad y gestiona sobre qué trabaja cada uno. Los
montajes de un agente son symlinks dentro de su workspace, así que esto es el
equivalente en terminal de la fila **works on** del Hall y de la pregunta 3 del
asistente.

```bash
agents-city agents list --card ~/.agents-city/alice/home/alice.md --data ~/.agents-city/alice/home
agents-city agents mounts --agent urgencias --data ~/.agents-city/alice/home
agents-city agents mount --agent urgencias --src ~/documentos/manual --data …
agents-city agents unmount --agent urgencias --name manual --data …
```

| Comando | Efecto |
|---|---|
| `list` | cada agente: nombre, slug, rol, runtime, tipo, directorio de trabajo |
| `mounts` | los montajes de un agente, como etiqueta y destino real |
| `mount --src RUTA` | monta un repo, un worktree o una carpeta de documentos |
| `unmount --name ETIQUETA` | quita ese montaje; la carpeta en sí no se toca |
| `sync` / `sync-all` | reconstruye los workspaces desde la ficha, como hace el lanzador |

Desmontar quita un symlink y una clave de la ficha. Nunca borra aquello a lo que
apuntaba el enlace.

### `agents-city city`

Abre el mapa local de una ciudad, sin arrancar una sesión de agentes.

```bash
agents-city city
agents-city city ~/.agents-city/alice/producto
```

Usa el puerto `8787` o el siguiente libre, enlaza en loopback y abre el
navegador. `Ctrl-c` detiene el servidor. `units.yml`, `parcels.yml`, la ficha y
el estado del bus alimentan la visualización.

El mapa está vivo, no es una postal. Tres capas escenifican lo que pasa AHORA,
todas derivadas de datos que el producto ya emite: la presencia (una casa en
mitad de un turno brilla y respira; una recién parada se enfría), el
ayuntamiento (las sesiones del comité se representan en escena — las posiciones
selladas llegan volando boca abajo, la palabra es una mano alzada, la
verificación estampa la puerta y el cierre archiva el acta — con la cámara
volando a la sesión y los miembros caminando hasta ella), y una puerta por
carretera, por la que salen las cartas hacia otras ciudades. Los agentes tienen
caras identicón deterministas, las parcelas `knowledge`/`coordinator` visten
una familia de edificios distinta de `code`, el ayuntamiento y las puertas son
clicables, `P` (o el control ⛶) alterna pantalla completa, y el rail en vivo
del Hall se redimensiona arrastrando su borde. El contrato completo está en
[docs/map-live-layers.md](docs/map-live-layers.md).

### `agents-city shortcut`

Pone una ciudad en tu escritorio: su nombre, un icono coloreado a partir de su
propia identidad, y un doble clic que la abre.

```bash
agents-city shortcut               # la ciudad seleccionada
agents-city shortcut product       # una concreta
agents-city shortcut --hall        # una puerta que abre el mapa en vez del asiento
agents-city shortcut --remove      # quitarlo del escritorio
agents-city shortcut --to ~/bin    # escribirlo en otro sitio
```

| Opción | Efecto |
|---|---|
| `--hall` | el acceso directo abre el mapa en el navegador en vez de la ciudad tmux |
| `--remove` | quita el acceso directo de esta ciudad |
| `--to DIR` | lo escribe en otra carpeta que no sea el escritorio |

Lo que se escribe depende del escritorio, y en cada uno es de verdad, no un
script disfrazado:

| Plataforma | Acceso directo | Icono |
|---|---|---|
| macOS | bundle `.app` que abre la ciudad en Terminal | `.icns`, construido con el `iconutil` del sistema |
| Linux | entrada `.desktop`, marcada como confiable donde hay `gio` | `.png` bajo `XDG_DATA_HOME` |
| Windows (WSL) | `.lnk` en el escritorio **de Windows**, que lanza `wsl.exe` | `.ico`, cuando hay interoperabilidad con PowerShell |

Todos ejecutan la misma línea que escribirías tú, así que el acceso directo es un
botón etiquetado sobre la puerta que ya existe, no una segunda forma de entrar. El
icono se genera sin ninguna librería de imagen: un PNG escrito a mano, envuelto
como `.ico` para Windows y convertido con `iconutil` en macOS.

En Windows la ciudad vive dentro de WSL, y un `~/Desktop` de ahí es el escritorio
del home de Linux que nadie mira: por eso el escritorio de Windows se le pregunta
a Windows, nunca se arma a partir del nombre de usuario, porque un escritorio
redirigido a OneDrive o a un perfil de dominio no está bajo
`C:\Users\<nombre>\Desktop`. Sin interoperabilidad se escribe un `.cmd` que
también se abre con doble clic: la misma puerta, con icono genérico.

### `agents-city demo`

Abre una ciudad ficticia y desechable en el Hall completo. El centro contiene
el mapa; el lateral derecho reproduce una deliberación guiada y los mismos
turnos aparecen como bocadillos `Para …:` sobre sus agentes. Hay una demo por
dominio — caos real contado en palabras llanas, no en frases de programadores:

```bash
agents-city demo                     # software · Aurora Games — la noche en que desaparecieron las partidas
agents-city demo --domain medicina   # Clínica Alba — la mañana de las citas duplicadas
agents-city demo --domain legal      # Costa & Ley — el plazo de mañana a las nueve
agents-city demo --no-browser
```

No arranca modelos ni necesita cuentas de Claude, Codex, OpenCode o Kimi. Las
historias son presentación declarada, pero su ingeniería no es una animación:
los 22 eventos recorren el WebSocket autenticado, la máquina de estados del
comité, el registro durable y el feed de espectador reales. Cada historia
recorre la máquina ENTERA, incluida la parte que las demos suelen esconder:
tres posiciones aisladas, dos palabras concedidas por el asiento, una decisión,
una verificación que FALLA, un replanteo, y solo entonces un cierre verificado.
La clínica y el despacho son ciudades agents-first — agentes knowledge y
coordinator, sin repositorios — así que ejercitan además el roster y las
familias de edificios del mapa.

En las ciudades demo, el rail en vivo del Hall muestra el control enmarcado
**guided committee**: `⟳ replay` repite la historia del dominio, y `⏸ pause` /
`▶ resume` detienen y reanudan el propio proceso narrador (`SIGSTOP`, una
pausa de verdad). `/api/demo` rechaza cualquier ciudad que no sea una demo
empaquetada: el comité de una ciudad real es real, y repetirlo sería publicar
ficción en un bus real.

La demo copia su ciudad y su runtime a una carpeta temporal. `Ctrl-c` cierra su
Hall, mapa y hub y elimina esa copia; no selecciona, reescribe ni arranca tus
ciudades. Si ya hay otro mapa en `8787`, usa otro puerto y el Hall comprueba la
identidad para no incrustar accidentalmente la ciudad equivocada.

### `agents-city report`

Calcula el crecimiento que puede representarse en el mapa y, opcionalmente, lo
envía al servicio de ciudad configurado.

```bash
agents-city report
agents-city report --data ~/.agents-city/alice/producto
agents-city report --url https://city.example.com --token "$CITY_TOKEN"
agents-city report --push --quiet
```

| Opción | Efecto |
|---|---|
| `--data RUTA` | usa otra carpeta de datos de ciudad |
| `--url URL` | sustituye la URL del servicio |
| `--token TOKEN` | sustituye el token de autenticación |
| `--push` | envía el informe; sin este flag sólo lo calcula/muestra |
| `--quiet` | reduce la salida humana |

### `agents-city tokens`

Agrega consumo de transcripciones locales de Claude y puede enviar sólo los
totales. No envía prompts, respuestas ni rutas de ficheros.

```bash
agents-city tokens
agents-city tokens --days 7
agents-city tokens --all
agents-city tokens --push --quiet
agents-city tokens --url https://city.example.com --token "$CITY_TOKEN"
```

| Opción | Efecto |
|---|---|
| `--days N` | ventana temporal; por defecto 30 días |
| `--all` | relee las transcripciones dentro de `--days`, ignorando la caché incremental |
| `--url URL` | sustituye la URL del servicio |
| `--token TOKEN` | sustituye el token de autenticación |
| `--push` | envía agregados; sin este flag sólo los muestra |
| `--quiet` | reduce la salida humana |

`tokens` no estima automáticamente el consumo de Codex, OpenCode o Kimi.

### `agents-city logs`

Lee los dos flujos locales persistentes de la ciudad seleccionada: actividad
semántica visible y diagnósticos operativos con secretos eliminados. No lee el
razonamiento del proveedor.

```bash
agents-city logs
agents-city logs --activity --lines 50
agents-city logs --diagnostics --lines 200
agents-city logs --follow
agents-city logs --json --follow
```

| Opción | Efecto |
|---|---|
| `--activity` | sólo prompts, respuestas, trabajo y actos de comité visibles |
| `--diagnostics` | sólo diagnósticos de hub, sockets, gateways, hooks y launchers |
| `-n, --lines N` | registros iniciales; por defecto 100 |
| `-f, --follow` | sigue mostrando registros nuevos hasta `Ctrl-c` |
| `--json` | emite los registros JSONL almacenados sin transformarlos |

Los ficheros están en el runtime privado de la ciudad como `activity.jsonl` y
`diagnostics.jsonl`. Sobreviven a recargar el Hall y reiniciar el bus, tienen
modo `0600` y se pueden inspeccionar directamente. Los IDs de origen hacen
idempotentes las notificaciones o hooks repetidos del proveedor.

### `agents-city benchmark`

Mide transporte, runtimes reales o la estructura del protocolo de comité.

#### Stress local, sin gastar cuota de modelos

```bash
agents-city benchmark stress
agents-city benchmark stress --agents 40 --rounds 2 --timeout 20
agents-city benchmark stress --agents 80 --rounds 5 --json
agents-city benchmark stress --keep
```

| Opción | Efecto |
|---|---|
| `--agents N` | actores simulados; debe ser par, por defecto 40 |
| `--rounds N` | rondas por actor; por defecto 2 |
| `--timeout SEG` | límite del benchmark; por defecto 20 |
| `--json` | salida legible por máquina |
| `--keep` | conserva el workspace temporal para inspección |

#### Runtimes reales, con consumo de cuota

```bash
agents-city benchmark live --runtime claude --runtime codex
agents-city benchmark live \
  --runtime codex \
  --runtime kimi \
  --timeout 180 \
  --json
agents-city benchmark live \
  --command codex="codex --model gpt-5" \
  --command opencode="opencode -m lmstudio/qwen3-coder" \
  --keep
```

| Opción | Efecto |
|---|---|
| `--runtime RUNTIME` | runtime a medir; repetible: `claude`, `codex`, `kimi`, `opencode` |
| `--command RUNTIME=COMANDO` | comando concreto para ese runtime; repetible |
| `--timeout SEG` | límite de cada caso; por defecto 180 |
| `--json` | salida legible por máquina |
| `--no-save` | no guarda el resultado en el historial local |
| `--keep` | conserva los workspaces temporales |

`live` hace llamadas reales a los proveedores instalados y puede consumir cuota
o dinero. Comprueba autenticación y límites antes de lanzarlo.

#### Protocolo de comité

```bash
agents-city benchmark committee
agents-city benchmark committee --json
```

Compara el flujo estructurado con un chat no acotado: barrera de respuestas,
turnos, decisión y verificación. Es un benchmark estructural determinista; no
demuestra por sí solo mayor calidad de respuesta ni una afirmación SOTA.

### `agents-city reset`

Reinicia ciudades gestionadas conservando su identidad estable y sus repos.

```bash
agents-city reset product --dry-run   # muestra cada efecto, no cambia nada
agents-city reset product
agents-city reset product cliente-a   # varias, separadas por espacios
agents-city reset all                 # todas las de este propietario
```

Un nombre desconocido aborta la ejecución **entera** antes de tocar nada:
reiniciar tres ciudades y pararse en una errata es el peor final posible para un
comando destructivo. El Hall tiene lo mismo como botón, en **Cities** — primero
enseña qué desaparece, qué sobrevive y dónde queda la copia, y te pide escribir
el nombre de la ciudad.


El plan de reset:

1. valida que el destino sea una ciudad gestionada, no una ruta arbitraria;
2. muestra y detiene sólo su sesión/runtime;
3. crea un backup recuperable bajo el propietario;
4. conserva `id`, propietario, nombre y slug;
5. elimina configuración, deliberaciones y estado generado de esa ciudad;
6. no toca los repos de código;
7. elimina simétricamente las carreteras locales incidentes;
8. deja la ciudad lista para repetir onboarding.

No existe todavía un comando automático `restore`; la ruta exacta del backup
se imprime para una recuperación manual. Ejecuta siempre primero `--dry-run`.

### `agents-city exit`

Detiene sesiones y procesos de Agents City; no borra configuración.

```bash
agents-city exit producto --dry-run
agents-city exit producto
agents-city exit --dry-run
agents-city exit
```

Con una ciudad, cierra sólo su tmux, gateway y procesos auxiliares; el Hall puede
seguir activo. Sin ciudad, muestra o cierra todo lo gestionado por Agents City.
Una sesión tmux puede contener trabajo sin guardar, por lo que el dry-run es la
forma segura de comprobar el alcance.

### `agents-city doctor`

Revisa esta máquina y dice qué parte falta, en una pantalla.

```bash
agents-city doctor
```

Informa de las herramientas que necesita (python3, tmux, bash, git, node, y `gh`
como opcional), qué runtimes de agente hay instalados, **qué jaula te da este
kernel** —seatbelt, bubblewrap, o ninguna y por qué—, la ciudad seleccionada y su
ficha, si el bundle del Hall está construido, y si hay una versión más nueva
publicada. Sale con código distinto de cero cuando algo está roto, así que
también sirve dentro de un script.

Si le pasas un fichero de configuración, conserva su trabajo anterior: detectar
una forma antigua, explicarla y migrarla con `--fix` (dejando copia de
seguridad).

### `agents-city update`

```bash
agents-city update            # instala la versión publicada más nueva
agents-city update --check    # sólo pregunta: instalada frente a publicada
agents-city update --tag beta # sigue una dist-tag
```

La comprobación es **un GET al registro público de npm**, cacheado un día bajo
`~/.agents-city/.runtime/`. No se envía nada de tu máquina —ni identificador, ni
contador, ni telemetría— y `CITY_UPDATE_CHECK=0` lo desactiva por completo. Sólo
ocurre donde has abierto algo deliberadamente: `doctor`, `update` y el Hall (que
muestra una línea cuando hay versión nueva). Un `agents-city cities` normal no
toca la red.

Si lo instalaste desde un checkout de git, `update` se niega y te dice el comando
que encaja con tu instalación, en vez de ejecutar `npm install -g` sobre tu copia
de trabajo.

### `agents-city test`

Ejecuta la suite del checkout. Sin argumentos ejecuta todas las suites; con
nombres ejecuta sólo las indicadas.

```bash
agents-city test
agents-city test seat runtime-ui
agents-city test committee stress benchmark
```

Suites disponibles:

```text
widgets card parcels domains serve seat cities channel committee live-feed
runtime runtime-ui runtime-failures stress adapter benchmark contracts exit
cage broker launch
```

Este comando está pensado para contribuidores o para validar un tarball local;
una instalación de uso normal no necesita ejecutar los tests en cada arranque.

## Comité: flujo completo

El comité está diseñado como un comité de dirección: el asiento formula la
decisión y preside; los especialistas aportan evidencia desde sus repos; nadie
abre una conversación lateral; el asiento integra y otra identidad verifica.

```text
open
  └─ collecting: posiciones independientes y ocultas
       ├─ faltan respuestas + proceedWithout ─┐
       └─ responden todos -> review        │
                                            v
                                      synthesize
                                            │
                                            v
                                      deliberating
                               ┌─ palabra acotada ─┐
                               └─ floor request/reply ┘
                                            │
                                          decide
                                            │
                                            v
                                        verifying
                                  ┌─ fail ─└─ pass
                                  v               v
                         verification_failed   verified
                                  │               │
                                replan           close
                                  │               │
                                  └─> review        closed
```

### 1. Preparar el brief

Una buena pregunta nombra una decisión, no un tema. El resultado deseado explica
qué debe salir del comité; `definitionOfDone` contiene condiciones observables.
Selecciona sólo repos capaces de aportar evidencia relevante.

| Campo de `open` | Obligatorio | Valores/semántica |
|---|---|---|
| `question` | sí | la decisión exacta |
| `desiredOutcome` | sí | resultado concreto esperado |
| `context` | no | hechos mínimos necesarios |
| `constraints` | no | tiempo, coste, seguridad o política |
| `definitionOfDone` | sí, lista | criterios observables de aceptación |
| `authority` | no | `recommend`, `decide` o `execute`; por defecto `recommend` |
| `participants` | sí, lista | nombres de actores repo de esa ciudad |
| `maxRebuttals` | no | entero de 0 a 5; por defecto 2 por miembro |

`authority` documenta el mandato de la decisión; no cambia las ACL técnicas.

### 2. Recoger posiciones aisladas

Cada participante recibe el mismo brief y responde una sola vez:

```bash
agents-city committee respond "$DELIBERATION_ID" \
  --stance conditional \
  --recommendation "Lanzar primero al 10 %" \
  --evidence "npm test: 844 comprobaciones correctas" \
  --expected-impact "Detectar regresiones antes del despliegue total" \
  --visible-when "Tras 30 minutos de telemetría" \
  --withdraw-if "La migración no es reversible" \
  --risk "Capacidad insuficiente durante el canary" \
  --unknown "Carga real de la primera hora"
```

`stance` debe ser `support`, `oppose`, `conditional` o `abstain`. `evidence` es
obligatorio y repetible. La respuesta la ejecuta el runtime dentro de la ventana
del repo, con su identidad real. Hasta alcanzar la barrera, el asiento ve el
progreso, no el contenido de las primeras posiciones; esto reduce el anclaje.

### 3. Sintetizar sin votar

Cuando todas las posiciones están listas, el asiento integra evidencia:

```bash
agents-city committee synthesize "$DELIBERATION_ID" \
  --summary "Existe acuerdo sobre un canary reversible" \
  --agreement "La migración debe tener rollback probado" \
  --conflict "10 % frente a 25 % de tráfico inicial" \
  --unknown "Capacidad bajo el pico previsto"
```

Si falta un miembro, no basta con ignorarlo:

```bash
agents-city committee synthesize "$DELIBERATION_ID" \
  --summary "Síntesis provisional" \
  --proceed-without "QA está offline; el límite vence hoy y conservamos rollback"
```

La decisión se basa en evidencia, impacto y condiciones de retirada, no en contar
votos.

### 4. Pedir y conceder la palabra

Después de la síntesis un miembro sólo puede replicar si presenta una base
admitida:

```bash
agents-city committee floor-request "$DELIBERATION_ID" \
  --basis new_evidence \
  --reason "El canary falló en el test de rollback" \
  --evidence "artifacts/rollback.log: exit 1"
```

`basis` admite `new_evidence`, `contradiction`, `risk` o `dependency`. El asiento
resuelve la petición usando el `requestId` devuelto:

```bash
agents-city committee floor-grant "$DELIBERATION_ID" --request-id "$REQUEST_ID"
# o bien:
agents-city committee floor-deny "$DELIBERATION_ID" \
  --request-id "$REQUEST_ID" \
  --reason "La evidencia ya forma parte de la síntesis"
```

Al concederse, ese miembro tiene exactamente una réplica y libera el turno al
usarla:

```bash
agents-city committee reply "$DELIBERATION_ID" \
  --claim "No es seguro lanzar con el script actual" \
  --evidence "artifacts/rollback.log: exit 1" \
  --consequence "Bloquear hasta corregir y repetir rollback"
```

La réplica llega al asiento **y se oye en todo el comité**. Los demás miembros no
contestan directamente: si uno detecta evidencia nueva, contradicción, riesgo o
dependencia, pide otra vez la palabra al asiento. Éste concede o deniega y sólo
entonces habla ese agente. Así hay conversación real entre especialistas, pero
mediada como un comité de dirección, no un chat todos-contra-todos. No pueden
coexistir dos turnos activos; cada concesión permite una sola intervención;
`maxRebuttals` limita la cascada por miembro; y el asiento debe resolver todas las
peticiones pendientes antes de decidir.

### 5. Decidir y atribuir

```bash
agents-city committee decide "$DELIBERATION_ID" \
  --outcome "Corregir rollback y lanzar canary al 10 %" \
  --rationale "Reduce el radio de impacto y satisface el criterio reversible" \
  --owner "Responsable de release" \
  --executor api \
  --verifier qa \
  --verification-question "¿Rollback y canary pasan de extremo a extremo?" \
  --selected-evidence "suite completa verde" \
  --selected-evidence "fallo reproducible de rollback" \
  --decisive-contributors qa \
  --rejected-option "Lanzamiento total inmediato" \
  --dissent "web prefiere un canary del 25 %" \
  --reopen-if "errores 5xx > 1 % durante cinco minutos"
```

`selectedEvidence`, `decisiveContributors` y `reopenIf` son obligatorios. Si hay
otra identidad disponible, `verifier` no puede ser el mismo actor que `executor`.
La disensión se conserva en el acta aunque no cambie la decisión. Usa input JSON
cuando debas registrar más de un contribuidor decisivo.

### 6. Verificar, replanificar o cerrar

Sólo el verificador asignado puede ejecutar:

```bash
agents-city committee verify "$DELIBERATION_ID" \
  --result pass \
  --evidence "artifacts/e2e-rollback.txt" \
  --check "canary responde 200" \
  --check "rollback restaura la versión anterior" \
  --residual-risk "La primera hora a plena carga aún no está observada"
```

Con `fail`, el asiento debe replanificar y volver a sintetizar/decidir:

```bash
agents-city committee replan "$DELIBERATION_ID" \
  --reason "El rollback sigue dejando el esquema incompatible"
```

Con `pass`, el asiento puede cerrar:

```bash
agents-city committee close "$DELIBERATION_ID" \
  --summary "Canary verificado; despliegue autorizado" \
  --learning "Probar rollback antes de fijar la ventana de release" \
  --followup "Observar 5xx durante la primera hora"
```

Una deliberación no se puede cerrar sin verificación reproducible aprobada. Si
deja de ser relevante, el asiento puede usar:

```bash
agents-city committee cancel "$DELIBERATION_ID" \
  --reason "El release fue sustituido por otro candidato"
```

Estados, eventos y acta legible quedan en `deliberations/`; `history` resume
decisiones recientes y contribuciones decisivas para ayudar a detectar influencia
repetida. Ese recuento es una señal de revisión, no una prueba automática de sesgo.

## Comandos `/city:` de Claude

Estos comandos los aporta el plugin de Claude. No existen dentro de las TUI de
Codex, OpenCode o Kimi; en ellas se usan los comandos `agents-city` equivalentes.

| Comando | Caso de uso |
|---|---|
| `/city:setup [--city N] [--tui] [--demo]` | crear/abrir una ciudad mediante el flujo compartido |
| `/city:join [--domain D\|--role R\|--repos\|--agent-roles\|--goal\|--engines]` | nombre compatible para configurar el asiento; no añade otra persona |
| `/city:session [--no-yolo] [--only a,b]` | abrir o reanudar el tmux de esta ciudad |
| `/city:settings [domain\|role\|repos\|agent-roles\|goal\|engines\|roads\|skills]` | leer o cambiar una parte de la configuración |
| `/city:goals` | mostrar o editar el objetivo actual |
| `/city:committee PREGUNTA` | preparar y abrir una deliberación presidida |
| `/city:committee status ID` | inspeccionar el siguiente paso legal de una deliberación |
| `/city:round [--to owner/city] [--since FECHA]` | contrastar objetivo y evidencia local; consultar carreteras relevantes |
| `/city:notice [--pr N\|--since REF] [--dry]` | avisar de un cambio verificado sólo a ciudades afectadas |
| `/city:propose owner/city [ASUNTO]` | enviar una propuesta respaldada por evidencia |
| `/city:team` | alias histórico: lista ciudades, ciudad activa, repos y carreteras; no personas |
| `/city:exit [CIUDAD] [--dry-run]` | mostrar o cerrar procesos gestionados |

`/city:notice --dry` no envía nada. `/city:round` y `/city:propose` sólo pueden
usar destinos presentes en `road list`. Una respuesta de otra ciudad informa al
asiento; nunca adquiere autoridad para ordenar directamente a un repo local.

## Recetario de casos de uso

### Caso 1: empezar de cero con una ciudad y Claude

```bash
cd /ruta/al/checkout/agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city seat
```

1. Elige el dominio.
2. Elige el rol del asiento.
3. Selecciona repos o continúa sin ninguno.
4. Define u omite el objetivo.
5. Pulsa Enter en motores para conservar Claude.

Resultado: ciudad `home`, sesión `<owner>-home`, una ventana `seat` y una por repo
local seleccionado. Agents City mantiene un proceso oficial de Claude Code por
ventana y lo alimenta mediante `stream-json` persistente; no solicita un Channel
personalizado ni requiere aprobación admin o por ventana.

### Caso 2: usar Codex como asiento principal

```bash
agents-city seat --engines
```

En la fila `seat`, elige Codex; confirma el resto y abre la ciudad. Agents City
arranca `codex app-server` en loopback y abre la TUI oficial con
`codex --remote`. La TUI crea su thread persistido; el gateway detecta sólo el
thread nuevo de esa carpeta y se une mediante `thread/resume`. Debes poder
escribir directamente en Codex. Un prompt `city>` en la ventana del asiento
Codex indica una versión antigua o un arranque fallido; no es la interfaz
prevista para Codex.

### Caso 3: mezclar motores por repo

```bash
agents-city seat --city producto --engines
```

Ejemplo de selección:

```text
seat       Codex
api        Claude / modelo opus / esfuerzo high
web        Codex
analytics  OpenCode
research   Kimi
```

Cada elección persiste en la ficha. La siguiente ejecución de `seat` reutiliza
la configuración. Para probar otros motores sin mezclar procesos antiguos:

```bash
agents-city exit producto --dry-run
agents-city exit producto
agents-city seat --city producto --engines
```

### Caso 4: usar un modelo local mediante OpenCode

Agents City no decide el proveedor de OpenCode. En el picker de motores, elige
OpenCode e introduce el comando/modelo aceptado por tu instalación, por ejemplo:

```text
opencode -m lmstudio/qwen3-coder
```

Valida primero que el comando funciona solo:

```bash
opencode -m lmstudio/qwen3-coder
```

Después usa `agents-city seat --engines`. La entrega del bus llega por HTTP/SSE;
el modelo puede ser local aunque Agents City siga usando el mismo sobre tipado.

### Caso 5: usar una CLI todavía no integrada

Elige «otro comando (fallback de terminal)» en `--engines` e introduce, por
ejemplo, `gemini`. Agents City lo guarda como:

```yaml
runs.api: terminal:gemini
```

El prefijo hace explícito que esa ventana puede necesitar inyección visible en
tmux. Un comando desconocido sin `terminal:` se rechaza al leer una ficha editada
a mano; no degrada silenciosamente el transporte de los runtimes conocidos.

### Caso 6: crear varias ciudades del mismo usuario

```bash
agents-city cities create producto
agents-city seat --city producto

agents-city cities create cliente-a
agents-city seat --city cliente-a

agents-city cities list
```

Resultado esperado:

```text
~/.agents-city/<owner>/producto/
~/.agents-city/<owner>/cliente-a/
```

Cada una tiene dominio, rol, objetivo, repos, skills reconocidas, deliberaciones,
roads, runtime y sesión tmux propios. `home` no tiene ningún privilegio especial.

### Caso 7: asignar a cada repo una especialidad distinta

```bash
agents-city seat --city producto --agent-roles
```

Puedes asignar `po` al repo principal, `seo` al portfolio y `data-engineer` al
pipeline aunque el dominio del asiento sea `software`. El picker permite buscar
roles de otros dominios. La especialidad modifica la perspectiva y el contexto
editable; la autoridad técnica sigue siendo `member` para todos esos repos.

### Caso 8: trabajar sin un perfil precargado

```bash
agents-city seat --city laboratorio --role blank
agents-city seat --city laboratorio --agent-roles
```

Selecciona también `blank` en los repos que no deban recibir un perfil. No se crea
un fichero de conocimiento de rol ni se infiere uno oculto. Las instrucciones del
repo y sus skills siguen funcionando normalmente.

### Caso 9: conectar dos ciudades locales

```bash
agents-city road connect producto cliente-a
agents-city road list producto
agents-city road list cliente-a
```

La carretera se escribe en ambos extremos. Arranca ambas ciudades y desde el
asiento de una:

```bash
CITY_OWNER=alice
AGENTS_CITY_DATA="$HOME/.agents-city/$CITY_OWNER/producto" \
  agents-city bus send "$CITY_OWNER/cliente-a" "¿Afecta este cambio a vuestro contrato?"
```

En una sesión normal no hace falta establecer `AGENTS_CITY_DATA`: ya está
inyectado en cada ventana. El ejemplo lo hace explícito para una terminal externa.

### Caso 10: conectar ciudades de dos máquinas o personas

Con un operador de Roads gestionadas, cada persona empareja el ordenador y
elige la ciudad local que puede participar:

```bash
agents-city connect --city producto --service https://connect.example.com
agents-city connect --city research --service https://connect.example.com
```

Una persona crea la invitación de Road en ese servicio y la otra la acepta. Los
clientes conocen la Road bilateral activa mediante sus sesiones autenticadas
con el relay; ninguna parte intercambia un token compartido del bus ni expone un
puerto local. El contrato del cliente público está en
[docs/managed-connect.md](docs/managed-connect.md).

Para autoalojar el transporte remoto existente basado en token, intercambia en
cambio las invitaciones públicas de ciudad. En la máquina A:

```bash
agents-city road invite producto > producto.invitation.json
```

Transfiere ese JSON por un canal apropiado. No contiene el token del bus. En la
máquina B:

```bash
agents-city road connect research producto.invitation.json
agents-city road invite research > research.invitation.json
```

Devuelve la invitación de B y acéptala en A:

```bash
agents-city road connect producto research.invitation.json
```

Ambas máquinas necesitan el mismo transporte remoto compatible y credenciales
válidas mediante `CITY_BUS_URL`/`CITY_BUS_TOKEN`. La invitación sólo declara la
allowlist; no despliega infraestructura ni comparte secretos. Consulta
[docs/self-host.md](docs/self-host.md) para el Worker remoto.

### Caso 11: pedir una decisión a varios repos sin chat grupal

Desde el asiento Claude:

```text
/city:committee ¿Podemos activar la nueva migración en producción?
```

Desde cualquier otro runtime, prepara el brief y usa:

```bash
agents-city committee open --input migration-decision.json
```

El asiento selecciona sólo los repos relevantes. Cada primera respuesta queda
aislada; después hay síntesis, peticiones de palabra, decisión atribuida y
verificación. Usa `agents-city committee show ID` para ver el estado, no para
saltarse el siguiente actor legal.

### Caso 12: arrancar sólo uno o varios repos de una ciudad grande

```bash
agents-city seat --city producto --only api
agents-city seat --city producto --only api,web
```

`--only` filtra ventanas para ese arranque; no elimina repos ni roles de la ficha.
Si ya existe una sesión con otra composición, ciérrala de forma acotada antes:

```bash
agents-city exit producto --dry-run
agents-city exit producto
```

### Caso 13: seleccionar o clonar repos privados desde GitHub

```bash
agents-city seat --repos
```

Elige «mi cuenta GitHub» u «organización GitHub». Si `gh` falta, el asistente
intenta instalarlo; si no hay sesión, abre `gh auth login --web`. El navegador o
el código de dispositivo autentican `gh`, no Agents City. Los repos privados sólo
aparecen si ese token tiene alcance. Un repo seleccionado pero no clonado puede
quedar en la ficha sin ventana o clonarse, previa confirmación, bajo
`CITY_CODE_DIR` (por defecto `~/codigo`).

### Caso 14: inspeccionar skills sin instalarlas

```bash
agents-city skills producto
```

Si `api/.codex/skills/migraciones/SKILL.md` aparece, significa que el repo ya
posee esa skill. Agents City no la copia a la ciudad ni la impone al agente. Al
añadir, editar o quitar el `SKILL.md`, la siguiente lectura refleja el cambio sin
reinstalar Agents City.

### Caso 15: abrir sólo el mapa o la demo guiada

```bash
agents-city city ~/.agents-city/<owner>/producto
agents-city demo
```

`city` representa datos reales de esa ciudad. `demo` abre el Hall completo de
Aurora Games y reproduce agentes de presentación sobre la infraestructura real,
sin invocar modelos. Si quieres administrar tus ciudades, usa `agents-city hall`.

### Caso 16: medir rendimiento y detectar regresiones

Primero mide el bus de forma determinista y sin modelos:

```bash
agents-city benchmark stress --agents 40 --rounds 2 --json
```

Guarda el JSON como baseline. Después, si aceptas consumo de cuota, mide el camino
real:

```bash
agents-city benchmark live \
  --runtime claude \
  --runtime codex \
  --runtime kimi \
  --timeout 180 \
  --json
```

Compara por separado aceptación bus→runtime y tiempo extremo a extremo. Una
respuesta correcta del modelo no convierte una demora de transporte en «tiempo
de razonamiento»; una autenticación fallida tampoco se cuenta como muestra rápida.

### Caso 17: actualizar sin dejar sesiones con código antiguo

```bash
cd /ruta/al/checkout/agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city --version
agents-city exit producto --dry-run
agents-city exit producto
agents-city seat --city producto
```

Instalar un tarball no reescribe procesos ya vivos. Reiniciar sólo la ciudad evita
cerrar otra ciudad o un tmux ajeno.

### Caso 18: borrar la configuración de una ciudad y repetir onboarding

```bash
agents-city reset laboratorio --dry-run
agents-city reset laboratorio
agents-city seat --city laboratorio
```

El reset mantiene la identidad de `laboratorio`, crea backup y no toca sus repos.
Para borrar solamente procesos, usa `exit`, no `reset`.

## Ficheros y variables de entorno

### `city.yml`: identidad de la ciudad

Este fichero contiene la identidad estable y el dominio. No reutilices un `id`
copiando la carpeta para crear otra ciudad; usa `cities create`.

```yaml
id: city_a1b2c3d4
name: producto
slug: producto
owner: alice
domain: software
seat_yolo: 1
```

El address público se deriva como `owner/slug`; no se guarda como una identidad
global del plugin porque varias ciudades pueden ejecutarse a la vez.
`seat_yolo: 1` lanza el propio asiento sin preguntar permisos — se elige en la
sexta pregunta del asistente o con `agents-city seat --seat-yolo on|off`;
`--no-yolo` sigue frenando la sesión entera.

### `<owner>.md`: ficha del asiento

Es Markdown con frontmatter. Contiene el rol del asiento, repos, rol de cada repo,
objetivo y motor por ventana. Ejemplo reducido:

```yaml
---
user: alice
name: alice
role: cpto
agent: alice-producto-cpto
repos: [api, web, portfolio]
role.api: data-engineer
role.web: dev
role.portfolio: seo
goals_defined: true
runs.seat: codex
runs.api: claude
model.api: opus
effort.api: high
runs.web: codex
runs.portfolio: terminal:gemini
---
```

Los nombres tras el punto usan el actor normalizado de la ventana: minúsculas,
números y guiones. Usa `seat --repos`, `--agent-roles`, `--goal` y `--engines`
para mantener la ficha de forma segura. Una edición manual mal formada degrada el
rol operativo a `blank` o puede impedir el arranque; no se evalúa como código.

El cuerpo de la ficha conserva el objetivo y el historial de rondas. Cambiar el
objetivo reescribe sólo su sección, no ese historial.

### Conocimiento editable

```text
domains/<domain>.md
roles/<role>.md
AGENTS.md
```

Los dos primeros nacen como perfiles iniciales y pasan a pertenecer a la ciudad.
Puedes editarlos, reemplazarlos o quitarlos. Agents City no vuelve a sobrescribir
un fichero existente durante un cambio de configuración. `AGENTS.md` explica a
los runtimes cómo interpretar la ciudad; revísalo si haces una personalización
profunda.

Las skills permanecen en los repos y son independientes de estos ficheros.

### Estado de runtime

El hub local no mezcla datos efímeros con la configuración legible:

```text
~/.agents-city/.runtime/bus/<city-id>/
├── endpoint.json
├── hub.lock
├── road-token
├── actors/*.json
├── outbox/<actor>/*.json
├── road-queue/*.json
├── road-inbox/*.json
└── road-history.jsonl
```

Las credenciales y ficheros de runtime se crean con permisos privados. Los
outboxes permiten que un actor se reconecte sin perder tareas ya aceptadas; el
ACK elimina el pendiente. Los outboxes de actores y la cola local de reintentos
admiten 200 pendientes; el inbox de Roads admite 500 por defecto y devuelve como
máximo los 20 más antiguos en cada lectura. Una ráfaga crea una sola activación
agrupada del asiento, no un turno del modelo por mensaje, y cada runtime nativo
ejecuta como máximo un turno a la vez. Una cola llena aplica backpressure en vez
de borrar silenciosamente un elemento anterior. La vida de cada mensaje es de
72 horas. `bus inbox` consume `road-inbox`, no el historial append-only.

### Variables configurables

| Variable | Por defecto | Uso |
|---|---|---|
| `AGENTS_CITY_HOME` | `~/.agents-city` | raíz completa de datos y runtimes |
| `AGENTS_CITY_USER` | identidad local resuelta | fuerza el propietario para pruebas/migraciones |
| `AGENTS_CITY_DATA` | ciudad seleccionada | fuerza una carpeta de ciudad en una terminal externa |
| `CITY_CODE_DIR` | `~/codigo` | destino de clones aceptados desde GitHub |
| `CITY_SEARCH_IN` | raíces habituales del home | lista separada por `:` donde buscar (también `;`, para Windows) |
| `CITY_SEARCH_DEPTH` | `4` | profundidad máxima de esa búsqueda |
| `AGENTS_CITY_ORG` | vacía | filtra repos por organización; vacía significa todos |
| `CITY_SETTLE` | `8` | espera inicial, en segundos, para arrancar Claude |
| `CITY_STAGGER` | `1` | separación adicional por ventana Claude |
| `CITY_BUS_URL` | vacía | endpoint del bus remoto opcional |
| `CITY_BUS_TOKEN` | vacía | credencial para ese transporte remoto/mapa |
| `AGENTS_CITY_URL` | `CITY_BUS_URL` | endpoint de reporting/mapa si está separado |
| `CITY_DIR` | `~/.claude/channels/city-bus` | carpeta de compatibilidad para `.env` y hooks |
| `CITY_HOOKS` | `city` | `everywhere` ejecuta los hooks de conciencia en todas las sesiones de Claude, no solo en runtimes de ciudad |
| `CITY_DESKTOP` | `~/Desktop`, o el escritorio de Windows bajo WSL | dónde escribe `agents-city shortcut` |
| `CITY_CAGE` | `1` | `0` arranca todas las ventanas sin jaula |
| `CITY_ROAD_INBOX_MAX_PENDING` | `500` | capacidad local del inbox de Roads, entre 20 y 10.000; al llenarse aplica backpressure |
| `CITY_ROAD_INBOX_WAKE_INTERVAL_MS` | `300000` | intervalo mínimo entre activaciones agrupadas del backlog, de 30 segundos a 1 hora |
| `CITY_CAGE_DENY` | vacío | rutas extra que sellar, separadas por `:` |
| `CITY_CAGE_ALLOW_WRITE` | vacío | rutas extra que mantener escribibles, separadas por `:` |
| `CITY_UPDATE_CHECK` | `1` | `0` no pregunta nunca a npm si hay versión más nueva |
| `CITY_CAGE_BWRAP` | se sondea | `1`/`0` responde «¿puede este Linux crear un espacio de nombres?» sin sondear; el lanzador lo fija una vez por ciudad |

Ejemplos:

```bash
CITY_SEARCH_IN="$HOME/clientes:$HOME/codigo" \
CITY_SEARCH_DEPTH=6 \
agents-city seat --repos

AGENTS_CITY_HOME="$(mktemp -d)" \
AGENTS_CITY_USER=tester \
agents-city cities create laboratorio

CITY_SETTLE=0 CITY_STAGGER=0 agents-city seat --city producto
```

### Qué se le puede dar a una casa para trabajar

`plugin/scripts/busca.py` recorre tu disco una vez e indexa tres clases de sitio:

* **repositorios** — con el nombre de su remoto `origin`, no el de la carpeta en
  la que están, para que un clon se encuentre por el nombre que dirías en voz
  alta;
* **worktrees** — un worktree enlazado es la carpeta en la que de verdad trabaja
  un agente aislado, y aparece como `repo@rama`, una cosa distinta que elegir;
* **carpetas de documentos** — un directorio con escritura dentro y sin git por
  ninguna parte, que es lo que monta un agente `knowledge`.

Lee `.git/config` y `HEAD` directamente en vez de lanzar `git` una vez por
repositorio, así que un escaneo completo termina mientras alguien mira la
pantalla, y funciona allí donde funcione Python: macOS, Linux y Windows por
igual. Este índice es el que usa la **terminal**: `seat --repos`, y el lanzador
resolviendo el `repo@rama` de una ficha a una ruta de esta máquina.
`plugin/scripts/find-repos.sh` es un envoltorio fino para quien lo llama desde
shell, y sólo imprime la mitad git.

El **Hall** no lo usa, y a propósito: allí, elegir sobre qué trabaja un agente es
un explorador de carpetas. Recorres tu disco y coges lo que quieras — un
repositorio, un worktree, una carpeta de documentos, un fichero exacto — y no se
te adelanta nada ni se filtra nada. Una lista adivinada sólo puede ofrecerte lo
que sabía buscar, y es una lista más que leer antes de hacer aquello a lo que
venías.

El índice se cachea un día en `$XDG_CACHE_HOME/agents-city/lugares.tsv` o
`~/.cache/agents-city/lugares.tsv`. Tanto el formulario de casas del Hall como el
asiento ofrecen refrescarlo; desde terminal, `busca.py --refresh` lo reconstruye,
que es justo lo que quieres tras cambiar `CITY_SEARCH_IN` con la caché aún
válida.

Para ajustes de transporte, el orden es:

1. variable de entorno ya presente;
2. clave reconocida de `~/.claude/channels/city-bus/.env`;
3. sólo para el token en macOS, Keychain service `city@agents-city`.

La carga de `.env` admite únicamente claves conocidas y no puede redefinir
`PATH`. Variables como `CITY_ADDRESS`, `CITY_BUS_ACTOR`, `CITY_RUNTIME_KIND` y
`CITY_AGENT_ROLE` las inyecta la sesión para autenticar cada ventana; no deberías
guardarlas como configuración global.

## Seguridad y límites de confianza

- La conciencia del plugin se queda dentro de la ciudad: cada hook comprueba
  primero la identidad de ciudad (`CITY_BUS_ACTOR`) y calla en las sesiones
  normales de Claude — instalar el plugin no alista todas las conversaciones de
  la máquina. `CITY_HOOKS=everywhere` es el opt-in explícito a toda la máquina.
- El hub de cada ciudad enlaza un puerto aleatorio en `127.0.0.1`; no se publica
  en la LAN.
- Cada actor tiene token y rol propios. El asiento es `chair`; cada repo es
  `member`.
- Los miembros no reciben credenciales de carretera, no pueden llamar a
  `road.send` y no tienen ruta miembro→miembro.
- Sólo un sobre `seat -> seat` hacia una carretera declarada puede salir de una
  ciudad.
- Una invitación contiene identidad/dirección, nunca el token remoto.
- Los payloads de protocolo están limitados a 64 000 caracteres por campo de
  texto y los IDs/rutas se normalizan antes de usarse.
- Los runtimes conocidos usan APIs nativas. Sólo `terminal:<command>` permite el
  fallback visible de tmux.
- `report` y `tokens` son dry-run por defecto; enviar requiere `--push`.
- `reset` y `exit` tienen `--dry-run`; el primero crea backup y ninguno debe
  tocar tmux ajenos.

### La jaula, el broker y la cadena de auditoría

El modo yolo se queda — un comité no funciona si cada comando del bus necesita
un humano — pero «no me preguntes» y «puedes tocarlo todo» son ejes distintos,
y sólo el primero es yolo. En macOS las ventanas de repo de Claude, OpenCode y
Kimi arrancan dentro de un perfil seatbelt generado: las escrituras caen sólo en su propio repo y su
estado de runtime, y los ficheros que convierten una inyección de prompt en un
robo de credenciales (`~/.ssh`, `~/.git-credentials`, `~/.aws`, configs de gh
y de nube, tokens de carretera remota, y el propio
`~/.claude/.credentials.json` de Claude Code) quedan sellados en el kernel — lecturas
y escrituras, hijos y nietos incluidos. Al agente no se le pregunta nada: las
rutas prohibidas sencillamente no existen para él. Codex usa en cambio su
sandbox nativa `workspace-write` y no se envuelve en seatbelt: workers MCP como
`node_repl` aplican su propia sandbox y macOS rechaza esa operación dentro de un
proceso ya enjaulado. `CITY_CAGE=0` desactiva de forma deliberada la capa de
confinamiento aplicable.

**En Linux la jaula es bubblewrap.** El sello se construye como se construye en
Linux: un espacio de nombres de montaje donde las rutas selladas sencillamente
no están montadas, así que dentro de la jaula `~/.ssh` es un directorio vacío y
`~/.git-credentials` se lee como nada. La misma promesa que el seatbelt, con
otro mecanismo, y `bin/test-cage.py` lo demuestra contra un espacio de nombres
real en cada ejecución de CI en Linux: la clave plantada no se puede leer, el
repo sigue siendo escribible, una escritura en un directorio sellado nunca llega
al disco y un proceso nieto no se escapa.

Necesita `bubblewrap` instalado (`apt install bubblewrap`) y espacios de nombres
de usuario sin privilegios habilitados — Agents City comprueba que bwrap puede
crear uno de verdad en vez de fiarse de que exista el binario, y una máquina
donde no pueda lo dice y arranca sin jaula, exactamente como antes. En otras
plataformas no hay confinamiento: sin jaula, pon agentes sobre trabajo sobre el
que te sentirías cómodo ejecutando un script.

Como una ventana enjaulada no puede leer el token de `gh`, los PRs y pushes
pasan por un broker de credenciales opcional (`CITY_BROKER=1`): un proceso
pequeño del lado del dueño que guarda las credenciales, acepta tokens por
ventana atados a un único repo, rechaza cualquier acción sobre la rama por
defecto y apunta cada petición — servida o rechazada — en un registro de
auditoría encadenado por hashes que las ventanas no pueden tocar. Un byte
reescrito rompe la cadena y `broker.py verify` lo dice. Las comprobaciones
vivas contra el kernel y ambos caminos del broker, el feliz y el rechazado,
corren en `bin/test-cage.py` y `bin/test-broker.py`. El modelo completo, sus
diales y sus límites honestos están en [docs/security.md](docs/security.md).

Agents City aísla responsabilidades del protocolo, no crea una sandbox contra el
propietario del sistema operativo. Otro proceso con tu mismo usuario puede leer
tus repos, adjuntarse a tu tmux o leer ficheros privados de tu home. Para código
no confiable usa cuentas/VMs/contenedores separados y aplica también los permisos
del CLI de cada proveedor.

Un bus remoto amplía la superficie de confianza. Para el transporte autoalojado
con token, despliega HTTPS/WSS, rota tokens, limita los scopes y revisa
[docs/self-host.md](docs/self-host.md). Managed Connect usa en cambio firmas de
dispositivo y HPKE de extremo a extremo, y mantiene sus claves privadas en el
directorio sellado por la jaula `~/.agents-city/.runtime/connect/`; consulta
[docs/managed-connect.md](docs/managed-connect.md). Cualquiera de las dos Roads
autoriza intercambio de texto entre asientos. Ninguna implica confianza para
ejecutar comandos recibidos ni acceso al filesystem remoto.

## Resolución de problemas

### `agents-city seat` vuelve a una sesión que ya estaba abierta

Es el comportamiento normal. El nombre tmux es estable por propietario/ciudad.
Separa la interfaz con `Ctrl-b d` o inspecciona antes de cerrarla:

```bash
agents-city exit <ciudad> --dry-run
```

### He actualizado el paquete pero sigo viendo el comportamiento anterior

Un npm global nuevo no sustituye procesos vivos ni sesiones tmux. Comprueba qué
binario ejecutas y reinicia sólo la ciudad:

```bash
type -a agents-city
agents-city --version
npm root -g
agents-city exit <ciudad> --dry-run
agents-city exit <ciudad>
agents-city seat --city <ciudad>
```

Con `fnm`, `nvm` o `asdf`, cada versión de Node puede tener sus propios paquetes
globales. Instala el tarball con la misma versión de Node desde la que ejecutarás
`agents-city`.

### Codex muestra `city>` en vez de su TUI

Codex debe mostrar su TUI oficial. Verifica una versión que soporte
`app-server`/`--remote`, actualiza Agents City y reinicia la ciudad. Los logs
previos al arranque deben incluir el endpoint WebSocket, la espera del thread de
la TUI, `Codex TUI thread ... adopted over WebSocket` y la autenticación en el
bus. Tras el primer turno aparecerá también `joined over WebSocket`. `city>` sí
es actualmente la consola esperada para OpenCode y Kimi.

Si aparece `Failed to resume session ... no rollout found`, estás ejecutando la
ruta defectuosa de `0.3.0-beta.10`, que intentaba abrir un thread recién creado
con `codex resume --remote`. `0.3.0-beta.11` ya abría la TUI correcta, pero podía
esperar indefinidamente a que un thread vacío materializara su primer rollout.
Instala `0.3.0-beta.21` o posterior y reinicia sólo
esa ciudad con `agents-city exit <ciudad>` seguido de `agents-city seat --city
<ciudad>`.

### Aparece `fatal: not a git repository` en la ventana `seat`

La ventana `seat` vive en la carpeta de datos de la ciudad, que no tiene por qué
ser un repo. Las versiones actuales omiten el sync allí. Ese error antes de abrir
Codex suele significar que la sesión sigue ejecutando un launcher antiguo:
actualiza, usa `exit <ciudad>` y vuelve a abrirla. Un repo real sin `.git` sí debe
revisarse por separado.

### Claude dice que el plugin no está en la allowlist de Channels

Agents City `0.3.0-beta.21` y posteriores no arrancan Claude con `--channels`.
Ese mensaje identifica una sesión viva antigua o un Channel lanzado manualmente,
no una configuración ausente de la cuenta personal. **No** crees un fichero de
managed settings de máquina ni uses `sudo`. Actualiza Agents City, comprueba la
versión y reinicia sólo la ciudad afectada con `agents-city exit <ciudad>` y
`agents-city seat --city <ciudad>`. El log normal debe mostrar
`Claude Code ready over persistent stream-json` y `claude-stream-json ready`.

### Claude muestra `Claude API` o pide usage credits con una cuenta Team/Max

Un `CLAUDE_CODE_OAUTH_TOKEN`, API key, gateway URL o selector de Bedrock,
Vertex o Foundry heredado puede tener prioridad sobre el login sano de
Claude.ai guardado por el CLI. Inspecciona sólo los nombres; nunca imprimas los
valores de las credenciales:

```bash
claude auth status
tmux show-environment -g | cut -d= -f1 | \
  grep -E 'CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_'
env -u CLAUDE_CODE_OAUTH_TOKEN \
    -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
    -u CLAUDE_CODE_USE_FOUNDRY claude auth status
```

Si el último comando devuelve `authMethod: claude.ai`, Agents City usa ese
login y quita únicamente esos overrides de cada proceso hijo nuevo. Nunca borra
un token, hace logout ni reescribe el almacén de credenciales. Tras actualizar,
reinicia sólo esa ciudad. Para usar intencionadamente autenticación por entorno/API:

```bash
CITY_CLAUDE_AUTH=environment agents-city seat --city <ciudad>
```

### Las herramientas de Codex fallan con `sandbox_apply: Operation not permitted`

Es el fallo de sandbox anidada de macOS: un launcher antiguo metía la sandbox de
Codex (o la de un worker MCP) dentro de la jaula seatbelt de la ciudad. Instala
la beta actual y reinicia sólo la ciudad afectada. Codex arranca ahora sin la
jaula exterior y mantiene su confinamiento nativo `workspace-write`, así puede
leer el repo y usar herramientas sin un `sandbox_apply` anidado.

### Codex avisa de que falta el ejecutable de un MCP

Codex hereda tu registro MCP global. Agents City lo comprueba sin imprimir los
valores de su entorno. Si un MCP stdio habilitado apunta a un ejecutable que se
puede demostrar que no existe, se deshabilita sólo para ese proceso de ciudad;
no se modifica `~/.codex/config.toml` y los MCP sanos siguen activos. Puedes ver
la decisión acotada con:

```bash
agents-city logs --diagnostics | grep codex.mcp.unavailable.disabled
```

Después puedes reparar o borrar la entrada global original con `codex mcp`. Un
fallo de URL u otro error de arranque incierto se deja visible en vez de
ocultarlo por conjetura.

### Parece que se pega texto o un JSON en una ventana

Claude, Codex, OpenCode y Kimi no usan portapapeles ni `tmux paste`. Comprueba la
ficha:

```bash
agents-city seat --engines
```

Si la fila está configurada como `terminal:<command>`, has elegido el adapter de
compatibilidad y la inyección visible es esperada. Si un runtime conocido aparece
así, vuelve a seleccionarlo por su nombre nativo.

### Una ventana Claude muestra un comando acabado en `--da`, `--dangerously` o `-`

Es un comando de arranque antiguo truncado, no un mensaje de Claude ni del
WebSocket. Las versiones actuales guardan el comando completo en un launcher
privado y auditado, y escriben en tmux únicamente su ruta corta. Actualiza el
paquete y reinicia sólo esa ciudad:

```bash
agents-city --version
agents-city exit <ciudad> --dry-run
agents-city exit <ciudad>
agents-city seat --city <ciudad>
agents-city logs --diagnostics --follow
```

Si el launcher falla registra `launch.failed`, imprime en el panel el código de
salida y la ruta del log, y envía `runtime.launch.failed` a City live. Nunca
guarda el comando completo ni las credenciales.

### No aparecen mis repos

```bash
command -v git
git -C /ruta/al/repo remote get-url origin
CITY_SEARCH_IN="/ruta/raiz1:/ruta/raiz2" \
CITY_SEARCH_DEPTH=6 \
agents-city seat --repos
```

La detección exige `.git` (directorio o fichero de worktree) y un remote `origin`.
Si acabas de cambiar las raíces, ejecuta `plugin/scripts/busca.py --refresh`. `AGENTS_CITY_ORG` puede estar filtrando el repo;
déjala vacía para indexar todos los remotes.

### Tus CLIs, tal y como las tienes

Esto no compite con la CLI que ya usas. Las orquesta, y eso sólo funciona si
respeta lo que configuraste en ellas — tus plugins, tus skills, tus servidores
MCP, tu modelo, tus permisos.

Eso es una afirmación sobre tu máquina, así que va como comando y no como
promesa:

```bash
agents-city doctor --config          # qué añadimos, qué heredamos, qué no tocamos
agents-city doctor --config --json   # lo mismo, como datos
```

Imprime tres columnas por CLI, y la diferencia entre ellas es lo importante:

* **el trato** — lo que añadimos o pisamos. Es corto, cada línea dice *por qué*,
  y es lo que hace que el bus sea la única ruta entre agentes y que la jaula
  aguante. Sin eso no hay producto.
* **heredamos** — lo que a propósito *no* mandamos, para que tu propia CLI lea
  tu propia configuración. Tu modelo, tu esfuerzo, tu política de aprobación.
* **no tocamos** — lo que carga exactamente igual que siempre.

El informe y el runtime leen **el mismo fichero** —
`plugin/channel/runtime/arnes.json` — así que la afirmación no puede separarse
del comportamiento. Los conectores sacan sus valores de esa declaración en vez de
escribirlos a mano, y la suite falla si un runtime impone algo que la declaración
no menciona. Escribir esa comprobación encontró dos: un system prompt inyectado
en Kimi que no declaraba nadie, y un valor de sandbox escrito en dos sitios.

Donde tu ajuste y el nuestro se cruzan, gana el tuyo cuando puede: el
`approval_policy` de Codex se respeta si lo has puesto, y `on-request` es sólo el
recurso cuando no. El informe dice la consecuencia en voz alta — `never`
desactiva las herramientas de app y MCP — en vez de decidir en silencio que no
querías decir eso.

### Tu silla conserva tu propio Claude Code

La ventana del asiento abre **Claude Code de verdad** — tus plugins, tus skills,
tus servidores MCP, tu statusline, el autocompletado de slash commands, el
selector de modelo. Es el arnés que ya usas, en el panel, y es a propósito: la
silla es donde una persona trabaja a mano.

Sigue estando en el bus. Los hooks del plugin (`SessionStart`,
`UserPromptSubmit`, `Stop`, `SessionEnd`) reportan los prompts y las respuestas
de esa sesión como los mismos eventos `conversation.*` que reporta el gateway,
así que el ayuntamiento ve la conversación igual. Y lleva los dos flags que
hacen del bus la única ruta entre agentes — `crossSessionInbound: refuse` y
`--disallowed-tools SendMessage,ListAgents`. Un producto más silencioso con un
agujero dentro no sería un producto mejor.

**Las casas de los agentes conservan el gateway** y su prompt `city>`, porque lo
que compra el gateway es que el bus pueda *meter* trabajo en una ventana — que
es el oficio entero de una casa y nada del oficio de la silla.

Una clave de la ficha devuelve la silla a lo de antes:

```yaml
ui.seat: gateway     # el prompt de la ciudad en la silla, como antes
```

`CITY_UI=gateway` lo fuerza para un arranque. A las casas no se les pregunta:
una casa existe para recibir encargos, y el gateway es lo que lo hace posible.

### El motor con el que corre una casa

`model.<ventana>` y `effort.<ventana>` en la ficha dicen con qué corre una casa,
una sola vez, la mueva la CLI que la mueva. Claude los toma como flags; los
gateways nativos leen esa misma grafía del texto del comando y la mandan con el
turno — por eso una clave significa lo mismo para las cuatro:

| proveedor | modelo | esfuerzo |
| --- | --- | --- |
| `claude` | sí, un alias que resuelve la CLI (`opus`, `sonnet`…) | sí |
| `codex` | sí, el nombre que use tu Codex (`~/.codex/config.toml`) | sí |
| `opencode` | sí, `proveedor/modelo` | no existe ese ajuste |
| `kimi` | sí | no existe ese ajuste |

Un comando que ya lleva el flag se lo queda: `runs.dbt: codex --model o3` es
alguien diciendo lo que quería, y una clave genérica no debe pisar una frase
concreta. El esfuerzo sólo se escribe donde se lee, porque un flag que nadie lee
es justo como un control acaba pareciendo que funciona.

### Desinstalarlo del todo

```bash
agents-city uninstall           # dice exactamente qué se iría; no borra nada
agents-city uninstall --yes     # lo hace
agents-city uninstall --keep-cities --yes   # desconecta la máquina, conserva las ciudades
agents-city uninstall --npm --yes           # y quita también el paquete global
```

Cierra todas las sesiones, halls y mapas que el producto arrancó, quita los
accesos directos del escritorio y el registro del plugin de Claude, y borra
`~/.agents-city` (tus ciudades, su estado y sus copias), `~/.config/agents-city`,
`~/.cache/agents-city` y `~/.claude/channels/city-bus` — más el token del bus en
el Keychain de macOS.

Nunca toca tus repositorios, tus worktrees ni tus carpetas de documentos. La casa
de un agente guarda *enlaces* a eso, y lo único que se va es el enlace.

`reset` responde a la otra pregunta: vacía una ciudad, deja una copia y conserva
la instalación, para cuando piensas seguir usándolo.

### GitHub no muestra repos privados u organizaciones

```bash
gh auth status
gh api user --jq .login
gh auth refresh -s read:org
```

Comprueba primero el acceso directamente con `gh`; Agents City sólo consume esa
sesión. Para una organización con SSO puede ser necesario autorizar el token en
GitHub. Siempre puedes elegir repos del disco sin OAuth.

### Un repo de la ficha no abre ventana

La ficha puede referenciar un repo que no está clonado. Ejecuta `seat --repos` y
acepta clonarlo o clónalo manualmente dentro de una raíz indexada. Si dos nombres
se normalizan al mismo actor (por ejemplo, diferencias sólo en símbolos), Agents
City rechaza la colisión en vez de mezclar credenciales.

### El bus dice que ya está arrancando o ejecutándose

No borres locks mientras el proceso esté vivo. Inspecciona el alcance:

```bash
agents-city exit <ciudad> --dry-run
```

Si la sesión esperada existe, vuelve con `seat`. Si es un proceso huérfano
gestionado, `exit <ciudad>` lo cierra. El hub recupera por sí solo un lock cuyo PID
ya no existe; un lock recién creado se conserva para evitar dos hubs simultáneos.

### Un agente estaba offline cuando llegó una tarea

Los sobres internos aceptados quedan en su outbox hasta ACK, con TTL de 72 horas.
Reabre la misma ciudad/runtime para drenar la cola. Si el proveedor rechazó la
tarea, la entrega queda como fallo y no se inventa un ACK. Usa los logs y el
benchmark de runtime para separar rechazo nativo, autenticación y latencia.

### Una carretera local existe pero el destino aparece offline

`road connect` configura alcance; no arranca la otra ciudad. Abre ambas sesiones:

```bash
agents-city seat --city origen
agents-city seat --city destino
```

Una carretera remota necesita además `CITY_BUS_URL` y `CITY_BUS_TOKEN` válidos en
los dos extremos. Que el mensaje quede en cola no significa que el destino lo
haya aceptado ni que esté de acuerdo.

### El comité rechaza mi comando

Primero mira el estado y el schema:

```bash
agents-city committee show <id>
agents-city committee schema <verbo>
```

Los rechazos más comunes son correctos por diseño: el asiento intenta responder
como miembro, un miembro intenta decidir, falta una posición sin
`--proceed-without`, queda una petición de palabra pendiente, el verificador es el
ejecutor pudiendo elegir otro, o se intenta cerrar antes de `pass`.

### Quiero empezar de cero

No borres `~/.agents-city` entero si sólo falla una ciudad:

```bash
agents-city reset <ciudad> --dry-run
agents-city reset <ciudad>
agents-city seat --city <ciudad>
```

La salida indica el backup. Si sólo quieres reiniciar procesos, usa `exit`.

## Desarrollo y pruebas

### Validación completa

```bash
git clone https://github.com/jlcases/agents-city.git
cd agents-city
npm install
npm test
```

`npm test` ejecuta `./bin/test`: suites Python/shell, buses y runtimes nativos con
dobles deterministas, un tmux desechable sólo para el fallback desconocido,
stress de 40 actores, contratos cruzados y la allowlist del tarball. La ejecución
por defecto es offline y usa homes/repos temporales.

Pruebas enfocadas:

```bash
./bin/test seat runtime-ui
./bin/test channel committee runtime runtime-failures
./bin/test stress benchmark contracts exit
```

### Typecheck y bundles

```bash
cd city/web
npm run typecheck
npm run build

cd ../../plugin/channel
npm run typecheck
npm run build
```

El JavaScript generado de `plugin/channel` sí se publica. Cambiar TypeScript sin
reconstruir deja el tarball ejecutando código anterior.

### Validar el paquete exacto sin publicarlo

```bash
npm pack --dry-run
npm pack

CITY_TEST_PREFIX="$(mktemp -d)"
npm install -g --prefix "$CITY_TEST_PREFIX" ./agents-city-*.tgz
"$CITY_TEST_PREFIX/bin/agents-city" --version
"$CITY_TEST_PREFIX/bin/agents-city" --help
```

Para pruebas de onboarding, añade un `HOME`, `AGENTS_CITY_HOME` y
`AGENTS_CITY_USER` temporales. No apuntes una suite a tus ciudades reales.

La matriz y los invariantes completos están en [docs/testing.md](docs/testing.md).
Los benchmarks tienen guías propias en
[benchmarks/stress/README.md](benchmarks/stress/README.md),
[benchmarks/latency/README.md](benchmarks/latency/README.md) y
[benchmarks/committee/README.md](benchmarks/committee/README.md).

## Ediciones, licencia y confianza

Este repositorio es la **Community Edition**, con licencia
[Apache-2.0](LICENSE): libre de usar, modificar, self-hostear y construir
encima, con concesión explícita de patentes. La licencia no concede derechos
sobre el nombre *Agents City* — el código viaja, el nombre se queda.

Existe una **Enterprise Edition** sobre este mismo core: memoria semántica de
la ciudad (búsqueda vectorial sobre actas, avisos y deliberaciones), SSO,
auditoría entre ciudades y gestión de flota. No está en este repositorio.
Agents City lo construye [Arkatai](https://arkatai.com), estudio de
desarrollos agénticos — para la Enterprise Edition escribe a
<hello@arkatai.com> o abre un issue con la etiqueta `enterprise`.

**Sin telemetría.** El producto no llama a casa de nadie: todo corre en
loopback y ficheros locales, y nada de tu trabajo sale de tu máquina salvo lo
que tú configures — una carretera remota o un `--push` a tu propio worker. La
única petición a terceros de las páginas web es la carga de sus tipografías
desde Google Fonts.
