/**
 * The Hall in Spanish.
 *
 * Keyed by the English source sentence, so an entry that goes missing degrades
 * to English rather than to an identifier. Written as somebody would say it out
 * loud — "la casa donde vive un agente", not "el contenedor del agente" — for
 * the same reason the English says "who lives here" instead of "roster
 * management": the metaphor is the product.
 */
import { anota } from './idioma';

anota({
  // ── the rail ──────────────────────────────────────────────────────────────
  Overview: 'Resumen',
  'The map': 'El mapa',
  'My seat': 'Mi asiento',
  Districts: 'Distritos',
  Roads: 'Carreteras',
  Reception: 'Recepción',
  Committee: 'Comité',
  Houses: 'Casas',
  'All cities': 'Todas las ciudades',
  'you are in': 'estás en',
  '{n} house': '{n} casa',
  '{n} houses': '{n} casas',
  'Create another city →': 'Crear otra ciudad →',

  // ── reception ────────────────────────────────────────────────────────────
  reception: 'recepción',
  'Messages wait for you, not your agents': 'Los mensajes te esperan a ti, no a tus agentes',
  'Remote text stops here as inert text. Read it, reject it with a reason, or choose the cities that should receive it. Until then no model can read it.':
    'El texto remoto se detiene aquí como texto inerte. Léelo, recházalo con un motivo o elige qué ciudades deben recibirlo. Hasta entonces ningún modelo puede leerlo.',
  'routing mode': 'modo de enrutado',
  'Manual review': 'Revisión manual',
  'Every message needs a person before it reaches a city.':
    'Cada mensaje necesita a una persona antes de llegar a una ciudad.',
  'Auto router not configured': 'Router automático sin configurar',
  'Configure Auto': 'Configurar Auto',
  'Automatic routing': 'Enrutado automático',
  'Only one clear, low-risk rule match can leave the human queue automatically.':
    'Solo una coincidencia clara y de bajo riesgo puede salir automáticamente de la cola humana.',
  'Routing policy': 'Política de enrutado',
  'Keep human review': 'Mantener la revisión humana',
  'Use the local rule router': 'Usar el router local de reglas',
  'Write comma-separated words or phrases for each destination. Empty cities are never selected.':
    'Escribe palabras o frases separadas por comas para cada destino. Las ciudades vacías nunca se eligen.',
  'e.g. contract, privacy, legal review': 'p. ej. contrato, privacidad, revisión legal',
  'Suspicious, unmatched, or ambiguous text always waits for you. Auto never executes, answers, or opens links.':
    'El texto sospechoso, sin coincidencia o ambiguo siempre te espera. Auto nunca ejecuta, responde ni abre enlaces.',
  'Save routing policy': 'Guardar política de enrutado',
  'Could not save the routing policy': 'No se pudo guardar la política de enrutado',
  'Routing policy saved.': 'Política de enrutado guardada.',
  'Reading your reception…': 'Leyendo tu recepción…',
  'Could not read your reception': 'No se ha podido leer tu recepción',
  'Reception clear': 'Recepción despejada',
  'No remote message is waiting for a decision.': 'No hay mensajes remotos esperando una decisión.',
  'message waiting': '{n} mensaje en espera',
  'messages waiting': '{n} mensajes en espera',
  'local only': 'solo local',
  'No agent has read this': 'Ningún agente ha leído esto',
  'Send to': 'Dirigir a',
  'Route to selected cities': 'Dirigir a las ciudades elegidas',
  'Reject and reply with a reason': 'Rechazar y responder con un motivo',
  'Reason sent back securely': 'Motivo que se devolverá cifrado',
  'Reason for rejecting this message': 'Motivo para rechazar este mensaje',
  'Reject and send reason': 'Rechazar y enviar el motivo',
  'Could not route the message': 'No se pudo dirigir el mensaje',
  'Message routed. Only the selected cities can now read it.':
    'Mensaje dirigido. Solo las ciudades elegidas pueden leerlo ahora.',
  'Could not reject the message': 'No se pudo rechazar el mensaje',
  'Message rejected. Your reason is queued for encrypted delivery.':
    'Mensaje rechazado. Tu motivo ha quedado en cola para enviarse cifrado.',
  'New encrypted message': 'Nuevo mensaje cifrado',
  'Messages leave from this computer with end-to-end encryption.':
    'Los mensajes salen de este ordenador con cifrado de extremo a extremo.',
  'message queued': '{n} mensaje en cola',
  'messages queued': '{n} mensajes en cola',
  'Write to': 'Escribir a',
  Message: 'Mensaje',
  'Your message will stop in their private reception.':
    'Tu mensaje se detendrá en su recepción privada.',
  'Send securely': 'Enviar de forma segura',
  'Reply to a rejected message': 'Respuesta a un mensaje rechazado',
  Dismiss: 'Descartar',
  'Could not queue the message': 'No se pudo poner el mensaje en cola',
  'Message queued on this computer.': 'Mensaje puesto en cola en este ordenador.',
  'Could not dismiss the response': 'No se pudo descartar la respuesta',

  // ── live activity rail ──────────────────────────────────────────────────
  'City live': 'Ciudad en directo',
  waiting: 'esperando',
  'A moderated conversation over the WebSocket bus. The seat routes each turn; private model reasoning is never shown or stored.':
    'Una conversación moderada sobre el bus WebSocket. El asiento dirige cada turno; el razonamiento privado de los modelos no se muestra ni se guarda.',
  'all conversations': 'todas las conversaciones',
  'show work': 'mostrar trabajo',
  'hide work': 'ocultar trabajo',
  'websocket live': 'websocket activo',
  reconnecting: 'reconectando',
  'session offline': 'sesión desconectada',
  'The bus is live. Questions, positions and moderated replies will appear here.':
    'El bus está activo. Aquí aparecerán preguntas, posiciones y respuestas moderadas.',
  'Start the city session. Its visible conversation will appear here as it happens.':
    'Inicia la sesión de la ciudad. Su conversación visible aparecerá aquí mientras sucede.',

  // ── the guide ─────────────────────────────────────────────────────────────
  Welcome: 'Bienvenida',
  'The work': 'El trabajo',
  'Your chair': 'Tu silla',
  'The houses': 'Las casas',
  Ready: 'Listo',
  'A city is you, and the houses around you': 'Una ciudad eres tú y las casas que te rodean',
  'Let’s build it': 'Vamos a construirla',
  'I’ll set it up myself': 'Ya lo configuro yo',
  'What kind of work happens here?': '¿Qué clase de trabajo se hace aquí?',
  'And what are you, here?': '¿Y tú qué eres aquí?',
  'Who lives in your city?': '¿Quién vive en tu ciudad?',
  'Who else lives here?': '¿Quién más vive aquí?',
  'Build the first house': 'Construye la primera casa',
  'Add another house': 'Añade otra casa',
  'That is everyone': 'Ya están todos',
  'Nobody yet — I answer alone': 'Nadie todavía — contesto yo solo',
  "A city with no houses does not delegate: the seat answers, and it is the only one who can. That is a real choice for a role whose work is other people's cities rather than folders — and it is not the usual one. Houses can be added later, from here or with <b>agents-city seat --agents</b>.":
    'Una ciudad sin casas no delega: contesta el asiento, y es el único que puede. Es una elección de verdad para un rol cuyo trabajo son las ciudades de otros y no las carpetas — y no es la habitual. Las casas se pueden añadir luego, desde aquí o con <b>agents-city seat --agents</b>.',
  'a new house': 'una casa nueva',
  'Who lives in it?': '¿Quién vive en ella?',
  'What do you call it?': '¿Cómo la llamas?',
  'What kind of work does it do?': '¿Qué clase de trabajo hace?',
  'It writes code': 'Escribe código',
  'It keeps knowledge': 'Guarda conocimiento',
  'It coordinates': 'Coordina',
  'What does it work on?': '¿Sobre qué trabaja?',
  'Build it': 'Constrúyela',
  'building…': 'construyendo…',
  Cancel: 'Cancelar',
  Back: 'Atrás',
  Next: 'Siguiente',
  'question 1 of 4': 'pregunta 1 de 4',
  'question 2 of 4': 'pregunta 2 de 4',
  'question 3 of 4': 'pregunta 3 de 4',
  'Open my session': 'Abrir mi sesión',
  'See the houses': 'Ver las casas',
  'Draw the map': 'Dibujar el mapa',
  'Set a goal': 'Poner un objetivo',
  '{city} is alive': '{city} está viva',

  // ── the houses ────────────────────────────────────────────────────────────
  'Who lives in {city}': 'Quién vive en {city}',
  '+ Build a house': '+ Construir una casa',
  '+ folder': '+ carpeta',
  '+ zip': '+ zip',
  test: 'probar',
  engine: 'motor',
  effort: 'esfuerzo',
  provider: 'proveedor',
  growth: 'crecimiento',
  'works on': 'trabaja sobre',
  skills: 'skills',
  'nothing mounted yet': 'aún sin nada montado',
  'none discovered': 'ninguna descubierta',
  connected: 'conectado',
  idle: 'inactivo',
  missing: 'no instalado',
  default: 'por defecto',
  'custom…': 'otro…',

  // ── cities ────────────────────────────────────────────────────────────────
  cities: 'ciudades',
  'Your cities': 'Tus ciudades',
  'Start another city': 'Empezar otra ciudad',
  'Create it': 'Crearla',
  open: 'abrir',
  archive: 'archivar',
  '· open now': '· abierta ahora',
  'Start this city over': 'Empezar esta ciudad de cero',
  'Start over…': 'Empezar de cero…',

  // ── the map ───────────────────────────────────────────────────────────────
  'the map': 'el mapa',
  'Your city, drawn': 'Tu ciudad, dibujada',
  'Draw my city': 'Dibujar mi ciudad',
  'Draw it anyway': 'Dibujarla igualmente',
  'baking the map — first time takes a minute':
    'horneando el mapa — la primera vez tarda un minuto',

  // ── shared ────────────────────────────────────────────────────────────────
  Saved: 'Guardado',
  Copied: 'Copiado',
  'reading your city': 'leyendo tu ciudad',
  'Could not save': 'No se pudo guardar',
});

anota({
  // ── the chrome that lives in the page itself ──────────────────────────────
  'town hall': 'ayuntamiento',
  'Manage one autonomous city: its seat, repo agents, roads and map. Everything here is a plain file you can also inspect by hand.':
    'Gobierna una ciudad autónoma: su asiento, sus agentes, sus carreteras y su mapa. Todo lo que hay aquí es un fichero de texto que también puedes abrir a mano.',

  // ── looking through the disk ──────────────────────────────────────────────
  'Its role — its speciality, never authority': 'Su rol — su especialidad, nunca su autoridad',
  'What runs it?': '¿Qué lo mueve?',
});

anota({
  // ── the guide, in prose ───────────────────────────────────────────────────
  'You take the chair. Around it, one <b>house</b> per worker — an <b>agent</b> — each with its own window, its own role and its own corner of your disk: a repository, three of them, a folder of documents, whatever it actually works on. The map draws them as houses that grow with the work done in them, and many houses are a city. They never talk to each other behind your back: you chair, they answer.':
    'Tú presides. A tu alrededor, una <b>casa</b> por trabajador — un <b>agente</b> — cada una con su ventana, su rol y su rincón de tu disco: un repositorio, tres, una carpeta de documentos, lo que de verdad tenga entre manos. El mapa las dibuja como casas que crecen con el trabajo hecho dentro, y muchas casas son una ciudad. Nunca hablan entre ellas a tus espaldas: tú presides, ellas responden.',
  'Everything lives as plain files in {donde}. Nothing leaves this machine, there is no account, and you can edit any of it by hand afterwards.':
    'Todo vive como ficheros de texto en {donde}. Nada sale de esta máquina, no hay cuenta que crear, y luego puedes editarlo a mano.',
  '<b>Four questions and you are working.</b> You can skip any of them and change everything later.':
    '<b>Cuatro preguntas y a trabajar.</b> Puedes saltarte cualquiera y cambiarlo todo después.',
  'It decides the vocabulary, the roles you will be offered and what counts as evidence in a decision. A clinic does not ship pull requests, and a law firm does not measure story points. Pick the closest one — you can change it later.':
    'Decide el vocabulario, los roles que se te ofrecen y qué cuenta como prueba en una decisión. Una clínica no entrega pull requests, y un despacho no mide story points. Elige el más cercano — luego se cambia.',
  'You chair this city whatever you answer — this is your <b>speciality</b>, not your authority. It shapes the perspective you bring to a decision and the knowledge files the city writes for you. <b>Blank</b> is a real answer: it means no preset knowledge.':
    'Presides esta ciudad respondas lo que respondas — esto es tu <b>especialidad</b>, no tu autoridad. Da forma a la perspectiva con la que entras en una decisión y a los ficheros de conocimiento que la ciudad escribe para ti. <b>En blanco</b> es una respuesta de verdad: significa sin conocimiento previo.',
  'Every house holds one worker — an <b>agent</b> — with its own window, its own role and its own corner of your disk. A house is <b>not</b> a repository: one can answer for three services and a folder of documents at once, and a house whose work is documents needs no git anywhere.':
    'Cada casa aloja a un trabajador — un <b>agente</b> — con su ventana, su rol y su rincón de tu disco. Una casa <b>no</b> es un repositorio: una sola puede responder por tres servicios y una carpeta de documentos a la vez, y una casa cuyo trabajo son documentos no necesita git en ninguna parte.',
  'Your seat is written and {cuantas}. Everything you just answered is a plain file you can read and edit.':
    'Tu asiento queda escrito y {cuantas}. Todo lo que acabas de responder es un fichero de texto que puedes leer y editar.',
  '<b>{n}</b> house stands around it': 'a su alrededor hay <b>{n}</b> casa',
  '<b>{n}</b> houses stand around it': 'a su alrededor hay <b>{n}</b> casas',
  'the city is waiting for its first house': 'la ciudad espera su primera casa',
  'What people usually do next:': 'Lo que suele hacerse ahora:',
  'A goal is optional, and the city works without one — but a round with no goal is a status report, because there is nothing to argue against.':
    'El objetivo es opcional y la ciudad funciona sin él — pero una ronda sin objetivo es un parte de estado, porque no hay nada contra lo que discutir.',

  // ── what a house does for a living ────────────────────────────────────────
  'Its house grows with the pull requests it merges. Mounts repositories and worktrees.':
    'Su casa crece con las pull requests que fusiona. Monta repositorios y worktrees.',
  'Its house grows with the documents it writes. Needs no git at all.':
    'Su casa crece con los documentos que escribe. No necesita git para nada.',
  'Its house grows with the decisions it records.':
    'Su casa crece con las decisiones que deja escritas.',
  'urgencias, api, the handbook — whatever you would say out loud':
    'urgencias, api, el manual — como lo llamarías en voz alta',
});

anota({
  // ── the app's own dialogs ─────────────────────────────────────────────────
  Yes: 'Sí',
  'What is it called?': '¿Cómo se llama?',
  'home, clients, the lab — whatever you would say out loud':
    'casa, clientes, el laboratorio — como lo dirías en voz alta',
  'A city is a place with its own seat, its own houses and its own map. Yours stay where they are.':
    'Una ciudad es un sitio con su propio asiento, sus casas y su mapa. Las que ya tienes se quedan donde están.',
  'Start over {city}?': '¿Empezar {city} de cero?',
  'Start over': 'Empezar de cero',
  'You lose:': 'Pierdes:',
  'You keep:': 'Conservas:',
  'Right now that is {agents} house(s), {roads} road(s) and {acts} committee act(s).':
    'Ahora mismo eso son {agents} casa(s), {roads} carretera(s) y {acts} acta(s) de comité.',
  'Type the city’s name to confirm': 'Escribe el nombre de la ciudad para confirmar',
  'Archive {city}?': '¿Archivar {city}?',
  'Archive it': 'Archivarla',
  'It moves into .backups. Nothing is deleted, and you can put it back by hand.':
    'Se mueve a .backups. No se borra nada, y puedes devolverla a mano.',
  'Which engine?': '¿Qué motor?',
  'Model alias': 'Alias del modelo',
  'An alias the CLI resolves when the window opens. Anything it accepts works here.':
    'Un alias que la CLI resuelve al abrir la ventana. Vale cualquiera que ella acepte.',
  'Use it': 'Usarlo',
  'Remove the skill {skill}?': '¿Quitar la skill {skill}?',
  'Remove it': 'Quitarla',
  'It is deleted from this agent’s own home. Nothing outside that folder is touched.':
    'Se borra de la casa de este agente. Nada fuera de esa carpeta se toca.',
  'Build a house': 'Construir una casa',
  'One worker, its own window, its own corner of your disk. Everything here can be changed afterwards.':
    'Un trabajador, su ventana y su rincón de tu disco. Todo esto se puede cambiar después.',
  '{name} has a house now': '{name} ya tiene casa',
  '{name} joined the city': '{name} se ha mudado a la ciudad',
  'What else does it work on?': '¿Sobre qué más trabaja?',
  'Mount it': 'Montarlo',
  Mounted: 'Montado',
  'Stop this agent working on {what}?': '¿Que este agente deje de trabajar sobre {what}?',
  'Unmount it': 'Desmontarlo',
  'The link goes. The folder it points at stays exactly where it is.':
    'Se va el enlace. La carpeta a la que apunta se queda exactamente donde está.',

  // ── what the form says when something is missing ──────────────────────────
  'Give it a name — it is how you will call it in its window':
    'Ponle un nombre — es como la llamarás en su ventana',
  'Could not add that agent': 'No se pudo añadir ese agente',
  'could not mount': 'no se pudo montar',
  'Could not set its engine': 'No se pudo fijar su motor',
  '{n} mount': '{n} montaje',
  '{n} mounts': '{n} montajes',
});

anota({
  // ── walking the disk ──────────────────────────────────────────────────────
  'Walk your disk and pick whatever you like: a repository, a worktree, a folder of documents, one exact file. As many as you want. Nothing is copied — each one is linked into this agent’s own home.':
    'Recorre tu disco y coge lo que quieras: un repositorio, un worktree, una carpeta de documentos, un fichero exacto. Tantos como quieras. No se copia nada — cada uno se enlaza dentro de la casa de este agente.',
  'Working on': 'Trabaja sobre',
  'Nothing chosen yet — an agent with no mounts is fine too.':
    'Aún no has cogido nada — un agente sin montajes también vale.',
  'Add this folder': 'Añadir esta carpeta',
  'Add this': 'Añadir esto',
  'Already chosen': 'Ya está cogido',
  'Up one folder': 'Subir una carpeta',
  'reading that folder': 'leyendo esa carpeta',
  'This folder is empty.': 'Esta carpeta está vacía.',
  'Only the first 2000 shown.': 'Sólo se muestran los 2000 primeros.',
  'A repository, a worktree, a folder of documents, one exact file. It is linked, never copied.':
    'Un repositorio, un worktree, una carpeta de documentos, un fichero exacto. Se enlaza, nunca se copia.',
});

anota({
  // ── the demo shelf ────────────────────────────────────────────────────────
  Demos: 'Demos',
  demos: 'demos',
  'See a committee happen': 'Mira un comité de verdad',
  'reading the demo shelf': 'leyendo la estantería de demos',
  'A real question, answered by a city of agents that never talk to each other behind the chair’s back. Pick the field closest to yours — the machine is the same one in all three; only the work changes.':
    'Una pregunta de verdad, respondida por una ciudad de agentes que nunca hablan entre ellos a espaldas de quien preside. Elige el campo más cercano al tuyo — la maquinaria es la misma en los tres; lo que cambia es el trabajo.',
  '{n} turns': '{n} turnos',
  'These are recordings of real runs over the real bus, played back here. To run one live in a terminal: agents-city demo --domain software.':
    'Son grabaciones de ejecuciones reales sobre el bus real, reproducidas aquí. Para lanzar una en vivo desde terminal: agents-city demo --domain software.',
  'All demos': 'Todas las demos',
  Play: 'Reproducir',
  Pause: 'Pausa',
  Replay: 'Repetir',
  '{done} of {total}': '{done} de {total}',
  'Press play. The turns arrive one by one, exactly as they did.':
    'Dale a reproducir. Los turnos van llegando uno a uno, tal cual llegaron.',
  'A recording of a real run: these events came off the real bus, from the real committee. Nothing here is being decided now.':
    'Una grabación de una ejecución real: estos eventos salieron del bus real, del comité real. Aquí no se está decidiendo nada ahora mismo.',
  'Nothing recorded here': 'Aquí no hay nada grabado',
  'This install has no demo recordings. Make them with demo/graba.py, or run the full thing from a terminal with agents-city demo.':
    'Esta instalación no tiene grabaciones. Créalas con demo/graba.py, o lanza la cosa entera desde terminal con agents-city demo.',
});

anota({
  '{n} folder': '{n} carpeta',
  '{n} folders': '{n} carpetas',
  '{n} file': '{n} fichero',
  '{n} files': '{n} ficheros',
  'files are below the folders': 'los ficheros van debajo de las carpetas',
});

anota({
  // ── what runs a house ─────────────────────────────────────────────────────
  'Leave all three on default and it runs the way you do. Whatever you set here is written once on the card, and the launcher hands it to whichever CLI runs this house.':
    'Déjalos los tres por defecto y funcionará como tú. Lo que pongas aquí se escribe una sola vez en la ficha, y el lanzador se lo pasa a la CLI que mueva esta casa.',
  'This CLI has no effort setting.': 'Esta CLI no tiene ajuste de esfuerzo.',
  'An alias the Claude CLI resolves when the window opens.':
    'Un alias que la CLI de Claude resuelve al abrir la ventana.',
  'The model name your Codex uses — the one in ~/.codex/config.toml.':
    'El nombre del modelo que usa tu Codex — el de ~/.codex/config.toml.',
  'OpenCode names a model provider/model, like anthropic/claude-sonnet-4.':
    'OpenCode nombra los modelos proveedor/modelo, como anthropic/claude-sonnet-4.',
  'The model name your Kimi CLI uses.': 'El nombre del modelo que usa tu CLI de Kimi.',
});

anota({
  // ── the seat, the goal, the day ───────────────────────────────────────────
  'my seat': 'mi asiento',
  'Save my seat': 'Guardar mi asiento',
  'work domain': 'dominio de trabajo',
  'your day': 'tu día',
  'the agents': 'los agentes',
  'repo agents': 'agentes de repo',
  'one goal — optional': 'un objetivo — opcional',
  'The goal, in one line': 'El objetivo, en una línea',
  'Concrete enough to argue with — empty skips it':
    'Lo bastante concreto como para discutirlo — vacío lo salta',
  'How it is measured': 'Cómo se mide',
  'in prose: the architect reads the AGENTS.md files on Fridays':
    'en prosa: el arquitecto lee los AGENTS.md los viernes',
  'The command that returns it, if a command can':
    'El comando que lo devuelve, si un comando puede',
  'What it returns today': 'Lo que devuelve hoy',
  'Where it has to get to': 'A dónde tiene que llegar',
  'By when': 'Para cuándo',
  'empty for a qualitative goal': 'vacío para un objetivo cualitativo',
  '…or who judges it, and how often': '…o quién lo juzga, y cada cuánto',
  'what is left': 'lo que queda',
  'open my session': 'abrir mi sesión',
  'Open the roster': 'Abrir la lista',

  // ── districts, roads, the committee ───────────────────────────────────────
  'districts & houses': 'distritos y casas',
  'Save districts & houses': 'Guardar distritos y casas',
  'another district…': 'otro distrito…',
  'The modelling no tool can do for you': 'El modelado que ninguna herramienta puede hacer por ti',
  'A house is <b>not a repo</b> — it is a parcel, a slice of one serving a single business unit. Split the interesting repos, give every house its district, and the map can say “this change touches banking” instead of “this change touches src/lib”.':
    'Una casa <b>no es un repo</b> — es una parcela, una porción de uno al servicio de una sola unidad de negocio. Parte los repos interesantes, dale a cada casa su distrito, y el mapa podrá decir «este cambio toca banca» en vez de «este cambio toca src/lib».',
  'Cities this one may reach': 'Ciudades a las que ésta puede llegar',
  'No roads yet. This city is isolated on purpose.':
    'Aún no hay carreteras. Esta ciudad está aislada a propósito.',
  'No unconnected local cities.': 'No hay ciudades locales sin conectar.',
  'other cities on this machine': 'otras ciudades en esta máquina',
  'remote invitation · public, no token': 'invitación remota · pública, sin token',
  'committee acts': 'actas del comité',
  'Decisions with a visible chain of custody': 'Decisiones con una cadena de custodia visible',
  'No committee acts yet. Open one only when the seat needs specialised evidence.':
    'Aún no hay actas. Abre un comité sólo cuando el asiento necesite pruebas especializadas.',
  'agents-city committee schema open': 'agents-city committee schema open',
  'guided committee': 'comité guiado',
  'Play the guided committee from the top': 'Reproducir el comité guiado desde el principio',
  'Pause or resume mid-scene': 'Pausar o seguir a mitad de escena',
  '⟳ replay': '⟳ repetir',
  '⏸ pause': '⏸ pausa',
  'seat moderates': 'el asiento modera',
  'read full message': 'leer el mensaje entero',

  // ── the cities view ───────────────────────────────────────────────────────
  'One person, several autonomous cities: each has its own identity, domain, chair, <b>its own houses</b> and its own roads. A house is not shared — it stands inside the city that owns it, with its workspace and mounts under that city’s folder — so two cities can each have a <code class="mono">docs</code> house and they are two different workers. They share nothing unless you build a road between them.':
    'Una persona, varias ciudades autónomas: cada una con su identidad, su dominio, su silla, <b>sus propias casas</b> y sus carreteras. Una casa no se comparte — está dentro de la ciudad que la posee, con su espacio de trabajo y sus montajes bajo la carpeta de esa ciudad — así que dos ciudades pueden tener cada una su casa <code class="mono">docs</code> y son dos trabajadores distintos. No comparten nada salvo que construyas una carretera entre ellas.',
  'client-a, research, the book…': 'cliente-a, investigación, el libro…',
  'which city this hall manages': 'qué ciudad gobierna este ayuntamiento',
  'Takes {city} back to its first day: no seat, no agents, no committee history, no map. Your repositories and document folders are <b>never touched</b> — only the city that points at them.':
    'Devuelve {city} a su primer día: sin asiento, sin agentes, sin historial de comité, sin mapa. Tus repositorios y carpetas de documentos <b>no se tocan</b> — sólo la ciudad que apunta a ellos.',

  // ── the houses ────────────────────────────────────────────────────────────
  'Agents &amp; skills': 'Agentes y skills',
  '<b>A house is where an agent lives and works</b>, and many houses are a city — it is the same thing the map draws, growing with what that agent actually does. The card and the CLI call them <code class="mono">agents</code>; here you see their houses.':
    '<b>Una casa es donde vive y trabaja un agente</b>, y muchas casas son una ciudad — es lo mismo que dibuja el mapa, creciendo con lo que ese agente hace de verdad. La ficha y la CLI los llaman <code class="mono">agents</code>; aquí ves sus casas.',
  'They belong to <b>this</b> city and only to it: each one’s workspace and its mounts live inside {donde}, so another city has its own people even if you give them the same names.':
    'Pertenecen a <b>esta</b> ciudad y sólo a ella: el espacio de trabajo de cada una y sus montajes viven dentro de {donde}, así que otra ciudad tiene su propia gente aunque les pongas los mismos nombres.',
  'a legacy repo agent works on its own repo':
    'un agente de repo heredado trabaja sobre su propio repo',
  'data repo': 'repo de datos',
  'skills recognised': 'skills reconocidas',
  'plugin installed': 'plugin instalado',
  'Reroll this agent’s face — deterministic, persisted on the card':
    'Vuelve a tirar la cara de este agente — determinista, guardada en la ficha',
  'Instructions the Claude runtime reads': 'Instrucciones que lee el runtime de Claude',
  'Instructions Codex, OpenCode and Kimi read': 'Instrucciones que leen Codex, OpenCode y Kimi',
  'Run the engine for real: --version, and the login state on Claude':
    'Ejecuta el motor de verdad: --version, y el estado de sesión en Claude',
  'Install a skill zip into this agent’s own home — the Claude runtime reads skills; other engines ignore them':
    'Instala un zip de skill en la casa de este agente — el runtime de Claude lee skills; los demás motores las ignoran',
  'Remove this skill from the agent’s home': 'Quitar esta skill de la casa del agente',

  // ── while it is reading ───────────────────────────────────────────────────
  'reading the domain packs': 'leyendo los paquetes de dominio',
  'reading the role files': 'leyendo los ficheros de rol',
  'an isometric house': 'una casa isométrica',

  'Nothing leaves this machine, there is no account, and everything is a plain file you can edit by hand afterwards.':
    'Nada sale de este ordenador, no hay cuenta, y todo es un fichero de texto que puedes editar a mano después.',
  'it will live in {donde}': 'vivirá en {donde}',
  // ── is this city actually running ─────────────────────────────────────────
  open: 'abierta',
  'not open — nothing of this city is running': 'cerrada — no hay nada de esta ciudad corriendo',
  'without its plugin: this city runs with none of its rules':
    'sin su plugin: esta ciudad corre sin ninguna de sus reglas',
  '{n} agent running': '{n} agente en marcha',
  '{n} agents running': '{n} agentes en marcha',

  // ── when the hall is not there ────────────────────────────────────────────
  'The town hall is closed': 'El ayuntamiento está cerrado',
  'This page is out of date': 'Esta página se ha quedado antigua',
  'It runs on this computer, not on the internet — so it stops when you stop it, and nothing was lost. Your city, your agents and everything you wrote are files on your disk, exactly as you left them.':
    'Se ejecuta en este ordenador, no en internet — así que se para cuando lo paras, y no se ha perdido nada. Tu ciudad, tus agentes y todo lo que escribiste son ficheros en tu disco, exactamente como los dejaste.',
  'The hall is running, but this tab is holding an address it no longer accepts. Nothing is wrong with your city — this page is just old.':
    'El ayuntamiento está abierto, pero esta pestaña guarda una dirección que ya no acepta. Tu ciudad está bien — la vieja es la página.',
  'To open it again, in a terminal:': 'Para volver a abrirlo, en una terminal:',
  'Try again': 'Reintentar',
  'Checking every few seconds…': 'Compruebo cada pocos segundos…',
  'Looking…': 'Mirando…',
});
