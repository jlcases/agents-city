"""The guided committees, one per domain — written for people, not programmers.

Each story is real chaos anybody recognises: losing what you had saved, a
waiting room double-booked, a legal deadline at nine tomorrow. The turns cross
the same authenticated bus and the same committee state machine as a real
city; only the words are scripted. Every story deliberately walks the WHOLE
machine, including the part demos usually hide: the first plan FAILS its
verification, the chair replans, and only the corrected plan closes.

Data only. `show.py` interprets it; `serve.py` lists it; the fixtures under
`demo/` give each story a city whose agents carry its domain's names.
"""

STORIES = {
    # ── software: Aurora Games — the night the saved games vanished ─────────
    "software": {
        "city": "city",
        "title": "La noche en que desaparecieron las partidas",
        "turns": [
            {
                "verbo": "open",
                "payload": {
                    "question": "¿Qué hacemos con las partidas que desaparecieron el sábado?",
                    "desiredOutcome": (
                        "Que cada persona afectada recupere lo suyo, y saber qué contamos "
                        "públicamente y cuándo."
                    ),
                    "context": (
                        "Desde el sábado por la noche hay jugadores que abren el juego y su "
                        "partida no está. Soporte acumula cientos de mensajes y todavía no "
                        "sabemos ni cuánta gente es ni por qué pasa."
                    ),
                    "constraints": [
                        "Nadie puede perder lo suyo dos veces",
                        "No contar públicamente nada que no sepamos seguro",
                    ],
                    "definitionOfDone": [
                        "Cada cuenta afectada tiene un camino para recuperar su partida",
                        "Mensaje público con hora y explicación honesta",
                    ],
                    "authority": "decide",
                    "participants": ["nova", "store-service", "telemetry-collector"],
                    "maxRebuttals": 2,
                },
            },
            {
                "verbo": "respond",
                "actor": "nova",
                "payload": {
                    "stance": "support",
                    "recommendation": (
                        "Lo primero es la gente: congelar la actualización del viernes y "
                        "decir hoy mismo, en público, que lo sabemos y estamos en ello."
                    ),
                    "evidence": [
                        "412 mensajes en soporte y subiendo",
                        "Una madre escribió: su hijo perdió seis meses de partida y no deja "
                        "de llorar",
                    ],
                    "expectedImpact": "La gente aguanta un fallo; no aguanta el silencio",
                    "visibleWhen": "En cuanto publiquemos el primer mensaje",
                    "withdrawIf": "Aparece una causa distinta a la actualización",
                    "risks": ["Prometer una hora y no llegar"],
                },
            },
            {
                "verbo": "respond",
                "actor": "store-service",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "Nadie ha entrado a robar nada: no es un ataque. El viernes cambiamos "
                        "cómo se guardan las partidas sin dejar puerta de vuelta. Propongo "
                        "recuperar las copias de la noche del jueves antes de tocar nada más."
                    ),
                    "evidence": [
                        "Las copias del jueves por la noche están completas y verificadas",
                        "Ningún acceso extraño en todo el fin de semana",
                    ],
                    "expectedImpact": "Recuperar lo perdido sin inventar nada",
                    "visibleWhen": "Al restaurar la primera tanda",
                    "withdrawIf": "Alguna copia del jueves resulta estar dañada",
                    "risks": ["Restaurar borra lo que se jugó después del jueves"],
                },
            },
            {
                "verbo": "respond",
                "actor": "telemetry-collector",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "Antes de decidir, contar bien a cuánta gente le pasa y a quién. No "
                        "es todo el mundo: es una franja concreta, y eso dice dónde mirar."
                    ),
                    "evidence": [
                        "3.804 cuentas afectadas por ahora",
                        "Casi todas jugaron el sábado entre las 22h y la 1h",
                    ],
                    "expectedImpact": "Avisar a los afectados directamente, no a bulto",
                    "visibleWhen": "Con la lista de cuentas en la mano",
                    "withdrawIf": "La franja crece fuera del sábado noche",
                    "unknowns": ["Cuántos afectados aún no han abierto el juego y no lo saben"],
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "Los tres coinciden: no es un ataque, viene del cambio del viernes y "
                        "hay copias del jueves. La discusión es el orden: ¿avisamos primero "
                        "o restauramos primero?"
                    ),
                    "agreements": [
                        "No es un ataque",
                        "La causa es el cambio del viernes",
                        "Hay copias del jueves por la noche",
                    ],
                    "conflicts": ["Avisar primero o restaurar primero"],
                    "unknowns": ["Afectados que aún no lo saben"],
                },
            },
            {
                "verbo": "palabra",
                "actor": "nova",
                "peticion": {
                    "basis": "new_evidence",
                    "reason": "Esto acaba de dejar de ser solo un problema técnico.",
                    "evidence": [
                        "Un streamer con dos millones de seguidores acaba de subir un vídeo "
                        "enseñando su partida vacía"
                    ],
                },
                "respuesta": {
                    "claim": (
                        "Si restauramos sin avisar y alguien pierde lo que jugó el domingo, el "
                        "enfado será doble. Primero el aviso con hora, después la restauración."
                    ),
                    "evidence": ["El vídeo lleva 40.000 visitas en una hora"],
                    "consequence": "El mensaje público pasa a ser lo más urgente de la lista.",
                },
            },
            {
                "verbo": "palabra",
                "actor": "store-service",
                "peticion": {
                    "basis": "risk",
                    "reason": "Restaurar tal cual tiene un precio que nadie ha dicho en voz alta.",
                    "evidence": [
                        "La copia es del jueves; lo jugado el viernes y el sábado no "
                        "está en ella"
                    ],
                },
                "respuesta": {
                    "claim": (
                        "Antes de restaurar hay que guardar aparte todo lo del fin de semana, "
                        "aunque tardemos dos horas más. Nadie pierde nada dos veces."
                    ),
                    "evidence": ["Guardar aparte las 3.804 cuentas lleva unas dos horas"],
                    "consequence": "La restauración se retrasa dos horas y se vuelve segura.",
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "A las 17h, mensaje público contando qué pasó y qué vamos a hacer. A "
                        "las 18h, guardar aparte todo lo del fin de semana. A las 20h, "
                        "restaurar las copias del jueves. Nadie pierde nada dos veces."
                    ),
                    "rationale": (
                        "Primero la confianza, después la restauración segura: las tres "
                        "posiciones caben en ese orden."
                    ),
                    "owner": "Ada",
                    "executor": "store-service",
                    "verifier": "telemetry-collector",
                    "verificationQuestion": (
                        "¿Tiene cada cuenta afectada un camino real para recuperar su partida?"
                    ),
                    "selectedEvidence": [
                        "Copias del jueves verificadas",
                        "Lista de 3.804 cuentas afectadas",
                        "Vídeo del streamer",
                    ],
                    "decisiveContributors": ["nova", "store-service", "telemetry-collector"],
                    "rejectedOptions": ["Restaurar en silencio y explicar después"],
                    "reopenIf": ["Aparecen afectados fuera de la franja del sábado"],
                },
            },
            {
                "verbo": "verify",
                "actor": "telemetry-collector",
                "payload": {
                    "result": "fail",
                    "evidence": [
                        "71 cuentas de la franja empezaron a jugar el viernes: no existen en "
                        "la copia del jueves"
                    ],
                    "checks": [
                        "Cruce de la lista de afectados contra las copias del jueves",
                        "Para 71 personas el plan no recupera nada",
                    ],
                    "residualRisks": ["Son precisamente los jugadores más nuevos"],
                },
            },
            {
                "verbo": "replan",
                "payload": {
                    "reason": (
                        "El plan deja fuera a 71 personas que empezaron después de la copia. "
                        "Un plan que recupera a casi todos no es un plan: se replantea."
                    )
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "El plan general sigue en pie; las 71 cuentas nuevas necesitan un "
                        "trato aparte: contacto directo y reconstrucción con lo que sí tenemos."
                    ),
                    "agreements": ["Mantener horario de aviso y restauración"],
                    "conflicts": [],
                    "unknowns": ["Cuánto se puede reconstruir de cada cuenta nueva"],
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "El mismo plan, más un equipo dedicado a las 71 cuentas nuevas: "
                        "contacto personal, compensación y reconstrucción manual de su "
                        "progreso con los registros del fin de semana."
                    ),
                    "rationale": "Nadie se queda fuera por haber llegado el último.",
                    "owner": "Ada",
                    "executor": "store-service",
                    "verifier": "telemetry-collector",
                    "verificationQuestion": (
                        "¿Tiene TODO el mundo — incluidas las 71 cuentas nuevas — un camino real?"
                    ),
                    "selectedEvidence": [
                        "Registros del fin de semana disponibles para "
                        "reconstrucción"
                    ],
                    "decisiveContributors": ["telemetry-collector", "store-service"],
                    "rejectedOptions": ["Compensar a las 71 cuentas solo con saldo"],
                    "reopenIf": ["La reconstrucción manual no llega en 48 horas"],
                },
            },
            {
                "verbo": "verify",
                "actor": "telemetry-collector",
                "payload": {
                    "result": "pass",
                    "evidence": [
                        "Prueba con 50 cuentas piloto: todas recuperan su partida",
                        "Las 71 cuentas nuevas contactadas una a una; 68 ya respondieron",
                    ],
                    "checks": [
                        "Restauración probada antes de la hora anunciada",
                        "Mensaje público revisado y con hora concreta",
                    ],
                    "residualRisks": ["Vigilar la franja del sábado durante una semana"],
                },
            },
            {
                "verbo": "close",
                "payload": {
                    "summary": (
                        "Partidas restauradas, mensaje publicado a su hora y las 71 cuentas "
                        "nuevas con seguimiento personal."
                    ),
                    "learnings": [
                        "Nunca más un cambio en el guardado sin puerta de vuelta",
                        "El silencio enfada más que el fallo",
                    ],
                    "followups": ["Revisar en una semana que ninguna cuenta reabrió queja"],
                },
            },
        ],
    },
    # ── medicina: Clínica Alba — the morning the appointments doubled ───────
    "medicina": {
        "city": "clinica",
        "title": "La mañana de las citas duplicadas",
        "turns": [
            {
                "verbo": "open",
                "payload": {
                    "question": "¿Cómo atendemos hoy a las 60 personas citadas a la misma hora?",
                    "desiredOutcome": (
                        "Que nadie con algo urgente se vaya sin ver a un médico, y que "
                        "quien deba volver salga con una cita real en la mano."
                    ),
                    "context": (
                        "El sistema de citas duplicó la agenda de esta mañana: hay 60 "
                        "personas en una sala de espera de 25, algunas mayores y de pie. "
                        "Entre ellas, una paciente crónica que viene solo a por su receta."
                    ),
                    "constraints": [
                        "Nadie urgente se va sin ser visto",
                        "A nadie se le dice 'vuelva usted mañana' sin cita concreta",
                    ],
                    "definitionOfDone": [
                        "Sala de espera por debajo del aforo antes de mediodía",
                        "Cada persona reprogramada con día y hora, no con promesas",
                    ],
                    "authority": "decide",
                    "participants": ["urgencias", "laboratorio", "farmacia"],
                    "maxRebuttals": 2,
                },
            },
            {
                "verbo": "respond",
                "actor": "urgencias",
                "payload": {
                    "stance": "support",
                    "recommendation": (
                        "Triaje en la puerta ahora mismo: una enfermera pregunta a cada "
                        "persona qué le pasa y separa lo que no puede esperar de lo que sí."
                    ),
                    "evidence": [
                        "Hay tres personas con más de 80 años de pie en el pasillo",
                        "Un niño con fiebre alta lleva 40 minutos esperando",
                    ],
                    "expectedImpact": "Lo urgente se ve hoy; lo demás se reprograma con respeto",
                    "visibleWhen": "En cuanto la enfermera esté en la puerta",
                    "withdrawIf": "El volumen desborda también el triaje",
                    "risks": ["Alguien urgente que no sabe explicar lo que le pasa"],
                },
            },
            {
                "verbo": "respond",
                "actor": "laboratorio",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "Que nadie repita pruebas por el caos: los análisis de esta semana "
                        "ya están hechos y valen. Puedo imprimir la lista de resultados "
                        "pendientes de entregar en diez minutos."
                    ),
                    "evidence": [
                        "34 resultados listos sin entregar",
                        "12 de las personas de la sala solo venían a recogerlos",
                    ],
                    "expectedImpact": "12 personas salen en minutos con lo que venían a buscar",
                    "visibleWhen": "Con la lista impresa en recepción",
                    "withdrawIf": "El sistema de resultados también está afectado",
                    "risks": ["Entregar un resultado a la persona equivocada con las prisas"],
                },
            },
            {
                "verbo": "respond",
                "actor": "farmacia",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "Las recetas de crónicos no necesitan consulta: renovarlas hoy en "
                        "ventanilla con la historia delante. La señora de la medicación "
                        "del corazón no debería esperar a un médico para su papel."
                    ),
                    "evidence": [
                        "9 personas de la sala vienen solo a renovar recetas",
                        "Todas son medicaciones crónicas ya pautadas",
                    ],
                    "expectedImpact": "9 personas más salen atendidas sin tocar la agenda médica",
                    "visibleWhen": "Al abrir la ventanilla de renovación",
                    "withdrawIf": "Alguna renovación exige cambio de dosis",
                    "risks": ["Renovar sin mirar una interacción nueva"],
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "Tres movimientos que no se pisan: triaje en la puerta, resultados "
                        "en recepción y recetas en ventanilla. La sala baja de 60 a unos 35 "
                        "sin cancelar a nadie. Falta decidir qué se hace con esos 35."
                    ),
                    "agreements": [
                        "Triaje inmediato",
                        "Entregar los 34 resultados",
                        "Renovar las 9 recetas crónicas",
                    ],
                    "conflicts": ["Qué decir a los ~35 restantes"],
                    "unknowns": ["Si la agenda de tarde también está duplicada"],
                },
            },
            {
                "verbo": "palabra",
                "actor": "urgencias",
                "peticion": {
                    "basis": "new_evidence",
                    "reason": "El triaje de la puerta acaba de encontrar algo.",
                    "evidence": [
                        "Un señor con dolor en el pecho llevaba 30 minutos callado en "
                        "la fila"
                    ],
                },
                "respuesta": {
                    "claim": (
                        "Ya está dentro y atendido. Pero confirma la regla: el triaje va "
                        "primero SIEMPRE, antes que cualquier reprogramación."
                    ),
                    "evidence": ["Atendido a los dos minutos del triaje"],
                    "consequence": "El orden del plan no se negocia: puerta primero.",
                },
            },
            {
                "verbo": "palabra",
                "actor": "farmacia",
                "peticion": {
                    "basis": "dependency",
                    "reason": "La ventanilla de recetas depende de poder ver la historia.",
                    "evidence": ["Dos terminales de recepción siguen caídos por lo de las citas"],
                },
                "respuesta": {
                    "claim": (
                        "Necesito un terminal que funcione en la ventanilla o renovaré a "
                        "ciegas, y a ciegas no renuevo."
                    ),
                    "evidence": ["El terminal de laboratorio está libre y funciona"],
                    "consequence": "Laboratorio presta su terminal dos horas y todo cuadra.",
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "Ahora mismo: triaje en la puerta. En paralelo, resultados en "
                        "recepción y recetas en ventanilla con el terminal del laboratorio. "
                        "A los ~35 restantes se les reprograma hoy con día y hora en mano, "
                        "empezando por los mayores."
                    ),
                    "rationale": (
                        "Cada persona de la sala cae en uno de los cuatro caminos, y ninguno "
                        "depende de arreglar el sistema de citas esta mañana."
                    ),
                    "owner": "Vera",
                    "executor": "urgencias",
                    "verifier": "laboratorio",
                    "verificationQuestion": (
                        "¿Está la sala por debajo del aforo y cada persona con su camino?"
                    ),
                    "selectedEvidence": [
                        "34 resultados listos",
                        "9 recetas crónicas renovables",
                        "Triaje encontró y atendió al señor del dolor de pecho",
                    ],
                    "decisiveContributors": ["urgencias", "laboratorio", "farmacia"],
                    "rejectedOptions": ["Cerrar la puerta y colgar un cartel"],
                    "reopenIf": ["La agenda de tarde también está duplicada"],
                },
            },
            {
                "verbo": "verify",
                "actor": "laboratorio",
                "payload": {
                    "result": "fail",
                    "evidence": [
                        "La agenda de TARDE también está duplicada: 48 citas para 24 huecos",
                        "Reprogramar a los 35 de la mañana hacia la tarde los mete en otra "
                        "sala llena",
                    ],
                    "checks": ["Revisión de la agenda de tarde antes de reprogramar hacia ella"],
                    "residualRisks": ["Repetir el caos a las 16h con la misma gente"],
                },
            },
            {
                "verbo": "replan",
                "payload": {
                    "reason": (
                        "Reprogramar hacia una tarde que también está rota es mover el caos "
                        "de sitio, no resolverlo. Se replantea con la tarde a la vista."
                    )
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "La reprogramación salta la tarde de hoy: va directa a huecos "
                        "reales de mañana y pasado, y la agenda de tarde se poda ahora "
                        "llamando a quien tenga cita duplicada antes de que venga."
                    ),
                    "agreements": ["No reprogramar hacia la tarde de hoy"],
                    "conflicts": [],
                    "unknowns": ["Cuánta gente de la tarde contesta al teléfono a tiempo"],
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "Los ~35 de la mañana salen con cita para mañana o pasado, no para "
                        "esta tarde. Dos personas de admisión llaman ahora a la lista de la "
                        "tarde para deshacer los duplicados antes de que nadie más venga."
                    ),
                    "rationale": "Se arregla la mañana sin fabricar el mismo problema a las 16h.",
                    "owner": "Vera",
                    "executor": "urgencias",
                    "verifier": "laboratorio",
                    "verificationQuestion": (
                        "¿Sala bajo aforo, caminos para todos, y la tarde podada a su aforo real?"
                    ),
                    "selectedEvidence": ["Agenda de tarde revisada: 48 citas para 24 huecos"],
                    "decisiveContributors": ["laboratorio", "urgencias"],
                    "rejectedOptions": ["Reprogramar hacia la tarde y cruzar los dedos"],
                    "reopenIf": ["Menos de la mitad de la lista de tarde contesta"],
                },
            },
            {
                "verbo": "verify",
                "actor": "laboratorio",
                "payload": {
                    "result": "pass",
                    "evidence": [
                        "12:40: sala con 19 personas, por debajo del aforo",
                        "Tarde podada a 26 citas; 22 duplicados avisados por teléfono",
                    ],
                    "checks": [
                        "Todos los urgentes vistos",
                        "35 reprogramados con día y hora en mano",
                        "Recetas crónicas renovadas, incluida la de la señora del corazón",
                    ],
                    "residualRisks": ["4 duplicados de tarde sin contestar el teléfono"],
                },
            },
            {
                "verbo": "close",
                "payload": {
                    "summary": (
                        "Mañana resuelta sin cerrar la puerta: urgencias vistas, resultados "
                        "entregados, recetas renovadas, reprogramación real y tarde podada."
                    ),
                    "learnings": [
                        "El triaje va antes que la logística, siempre",
                        "Nunca reprogramar hacia una agenda sin revisarla primero",
                    ],
                    "followups": ["Averiguar por qué el sistema duplicó las citas"],
                },
            },
        ],
    },
    # ── legal: Despacho Costa — the deadline at nine tomorrow ───────────────
    "legal": {
        "city": "despacho",
        "title": "El plazo de mañana a las nueve",
        "turns": [
            {
                "verbo": "open",
                "payload": {
                    "question": (
                        "¿Llegamos al plazo de mañana a las 9 con la reclamación de la "
                        "comunidad de vecinos?"
                    ),
                    "desiredOutcome": (
                        "Presentar en plazo algo completo y firmado, o saber HOY que no se "
                        "puede y decírselo a la clienta con alternativas, no con excusas."
                    ),
                    "context": (
                        "La reclamación por las goteras del edificio vence mañana a las "
                        "9:00. Al revisar el expediente esta tarde faltan dos firmas de "
                        "vecinos y el informe del perito tiene la última página en blanco. "
                        "La presidenta de la comunidad ha llamado dos veces, la segunda llorando."
                    ),
                    "constraints": [
                        "El plazo no se mueve: mañana a las 9:00",
                        "No se presenta nada incompleto que pueda tumbar el caso",
                    ],
                    "definitionOfDone": [
                        "Expediente completo y presentado, o la clienta avisada hoy con plan B",
                        "Nada pendiente de 'a ver si hay suerte'",
                    ],
                    "authority": "decide",
                    "participants": ["contratos", "litigios", "archivo"],
                    "maxRebuttals": 2,
                },
            },
            {
                "verbo": "respond",
                "actor": "litigios",
                "payload": {
                    "stance": "support",
                    "recommendation": (
                        "Se puede llegar, pero solo si esta tarde es solo para esto: las dos "
                        "firmas se consiguen yendo a los domicilios, no esperando emails."
                    ),
                    "evidence": [
                        "Los dos vecinos sin firmar viven en el mismo edificio",
                        "Uno ya dijo que sí por teléfono la semana pasada",
                    ],
                    "expectedImpact": "Las firmas, resueltas esta misma tarde en persona",
                    "visibleWhen": "Esta noche, con las firmas en el expediente",
                    "withdrawIf": "Alguno de los dos se niega en persona",
                    "risks": ["Que uno de los dos no esté en casa"],
                },
            },
            {
                "verbo": "respond",
                "actor": "contratos",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "La página en blanco del perito es lo grave: sin sus conclusiones "
                        "firmadas, la reclamación cojea. Hay que localizarle HOY; su oficina "
                        "cierra a las 18h."
                    ),
                    "evidence": [
                        "El informe se corrompió al escanearlo: el original en papel existe",
                        "El perito contestó un email esta mañana: está localizable",
                    ],
                    "expectedImpact": "Informe completo esta tarde si alguien va a su oficina",
                    "visibleWhen": "Con la última página escaneada de nuevo",
                    "withdrawIf": "El original en papel también estuviera incompleto",
                    "risks": ["Quedarse esperando un reenvío que no llega"],
                },
            },
            {
                "verbo": "respond",
                "actor": "archivo",
                "payload": {
                    "stance": "conditional",
                    "recommendation": (
                        "Antes de correr: comprobar QUÉ exige exactamente el juzgado para "
                        "tener por presentada la reclamación. Puede que las dos firmas que "
                        "faltan ni siquiera sean obligatorias para presentar."
                    ),
                    "evidence": [
                        "En un caso de 2024 se presentó con firmas pendientes y se "
                        "subsanaron después",
                        "El registro telemático admite hasta las 23:59, no hasta las 9:00",
                    ],
                    "expectedImpact": "Saber cuánto margen real hay antes de gastar la tarde",
                    "visibleWhen": "En una hora, con el requisito confirmado",
                    "withdrawIf": "Este juzgado exige el expediente completo sin subsanación",
                    "unknowns": ["Si el plazo de las 9:00 es de registro o de reparto"],
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "Nadie propone rendirse. Tres frentes a la vez: firmas en persona "
                        "esta tarde, el perito antes de las 18h, y archivo confirmando qué "
                        "es imprescindible presentar y hasta qué hora de verdad."
                    ),
                    "agreements": [
                        "Ir a por las firmas en persona",
                        "Ir a la oficina del perito hoy",
                        "Confirmar el requisito exacto del juzgado",
                    ],
                    "conflicts": ["Cuánto de esto es imprescindible y cuánto es prudencia"],
                    "unknowns": ["Hora real límite: ¿9:00 o 23:59 telemático?"],
                },
            },
            {
                "verbo": "palabra",
                "actor": "archivo",
                "peticion": {
                    "basis": "new_evidence",
                    "reason": "Ya está confirmado el requisito con el juzgado.",
                    "evidence": [
                        "Registro telemático hasta las 23:59 de mañana; las firmas son "
                        "subsanables en 10 días"
                    ],
                },
                "respuesta": {
                    "claim": (
                        "Tenemos 15 horas más de las que creíamos y las firmas no bloquean "
                        "la presentación. Lo ÚNICO imprescindible es el informe del perito."
                    ),
                    "evidence": ["Diligencia de subsanación admitida en este juzgado, caso 2024"],
                    "consequence": "Toda la presión se concentra en el perito antes de las 18h.",
                },
            },
            {
                "verbo": "palabra",
                "actor": "litigios",
                "peticion": {
                    "basis": "risk",
                    "reason": "Hay una trampa en confiarlo todo al registro telemático.",
                    "evidence": ["El registro telemático estuvo caído dos veces este mes"],
                },
                "respuesta": {
                    "claim": (
                        "Si apuramos a las 23:00 y el registro se cae, no hay plan B. Lo que "
                        "esté listo se presenta por la mañana, no por la noche."
                    ),
                    "evidence": ["Incidencias del registro: días 4 y 19 de este mes"],
                    "consequence": "La meta interna pasa a ser mañana a las 10:00, no a las 23:59.",
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "Esta tarde: una persona a la oficina del perito antes de las 18h y "
                        "otra a por las dos firmas en persona. Se presenta mañana a las "
                        "10:00 con lo imprescindible completo; las firmas, si no llegan, se "
                        "subsanan en los 10 días. A la presidenta se la llama HOY contando "
                        "el plan tal cual."
                    ),
                    "rationale": (
                        "El requisito real deja margen, pero el margen no se gasta: se "
                        "presenta por la mañana con el informe completo."
                    ),
                    "owner": "Marta",
                    "executor": "litigios",
                    "verifier": "archivo",
                    "verificationQuestion": (
                        "¿Está el expediente presentable a las 10:00 con el informe completo?"
                    ),
                    "selectedEvidence": [
                        "Requisito confirmado: firmas subsanables",
                        "Perito localizable hasta las 18h",
                    ],
                    "decisiveContributors": ["archivo", "contratos", "litigios"],
                    "rejectedOptions": ["Apurar al registro telemático de las 23:59"],
                    "reopenIf": ["El perito no aparece antes de las 18h"],
                },
            },
            {
                "verbo": "verify",
                "actor": "archivo",
                "payload": {
                    "result": "fail",
                    "evidence": [
                        "El original del perito tiene las conclusiones, pero firmadas por su "
                        "socio, que NO es el perito designado en el expediente"
                    ],
                    "checks": [
                        "Cotejo del original en papel con la designación del expediente",
                        "La firma válida tiene que ser del perito designado",
                    ],
                    "residualRisks": ["El perito designado está de viaje hasta mañana"],
                },
            },
            {
                "verbo": "replan",
                "payload": {
                    "reason": (
                        "El informe existe pero lo firma quien no debe. Presentarlo así es "
                        "regalarle a la otra parte un motivo de impugnación. Se replantea."
                    )
                },
            },
            {
                "verbo": "synthesize",
                "payload": {
                    "summary": (
                        "El perito designado vuelve mañana y puede firmar a primera hora en "
                        "el aeropuerto. Plan ajustado: firma a las 8:30, presentación a las "
                        "11:00, y la llamada a la clienta se adelanta a esta tarde."
                    ),
                    "agreements": ["La firma tiene que ser del perito designado, sin atajos"],
                    "conflicts": [],
                    "unknowns": ["Retraso del vuelo del perito"],
                },
            },
            {
                "verbo": "decide",
                "payload": {
                    "outcome": (
                        "Mañana 8:30, firma del perito designado a su llegada; 11:00, "
                        "presentación telemática con el expediente completo; las dos firmas "
                        "de vecinos ya conseguidas esta tarde se incorporan. Si el vuelo se "
                        "retrasa, se presenta a las 16:00 — todavía siete horas dentro de plazo."
                    ),
                    "rationale": (
                        "Un expediente impecable a las 11:00 vale más que uno impugnable a "
                        "las 9:00."
                    ),
                    "owner": "Marta",
                    "executor": "litigios",
                    "verifier": "archivo",
                    "verificationQuestion": (
                        "¿Presentado dentro de plazo, completo y con la firma del perito designado?"
                    ),
                    "selectedEvidence": [
                        "Vuelo del perito aterriza a las 8:05",
                        "Margen hasta las 23:59",
                    ],
                    "decisiveContributors": ["archivo", "litigios"],
                    "rejectedOptions": ["Presentar con la firma del socio y rezar"],
                    "reopenIf": ["El vuelo se cancela"],
                },
            },
            {
                "verbo": "verify",
                "actor": "archivo",
                "payload": {
                    "result": "pass",
                    "evidence": [
                        "Firmas de los dos vecinos conseguidas esta tarde en persona",
                        "Perito designado confirmado en el vuelo de las 8:05; firma a las 8:30",
                    ],
                    "checks": [
                        "Expediente montado y revisado dos veces esta noche",
                        "Presentación ensayada en el registro telemático con un borrador",
                        "La presidenta avisada: dejó de llorar cuando oyó el plan con horas",
                    ],
                    "residualRisks": ["Retraso del vuelo — cubierto por el margen de la tarde"],
                },
            },
            {
                "verbo": "close",
                "payload": {
                    "summary": (
                        "Reclamación presentada dentro de plazo, completa y sin flancos: "
                        "firmas conseguidas en persona, informe firmado por quien debía, y "
                        "la clienta informada con horas, no con promesas."
                    ),
                    "learnings": [
                        "Confirmar el requisito real antes de correr: cambió toda la tarde",
                        "Un expediente impecable tarde vale más que uno impugnable pronto",
                    ],
                    "followups": ["Revisar cómo se corrompió el escaneo del informe"],
                },
            },
        ],
    },
}
