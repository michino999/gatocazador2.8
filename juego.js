// ============================================================
//  GATO CAZADOR - juego.js (versión corregida)
// ============================================================
const canvas = document.getElementById("juego");
const ctx = canvas.getContext("2d");

// --- CONSTANTES: todos los números "de diseño" en un solo lugar ---
const DURACION_PARTIDA = 60;        // segundos que dura una partida
const BONUS_TIEMPO_NIVEL = 5;       // segundos extra al subir de nivel (pon 0 para quitarlo)
const CAPTURAS_POR_NIVEL = 5;       // ratones que hay que cazar para subir de nivel
const RADIO_CAPTURA = 40;           // distancia (px) entre centros para contar como captura
const DISTANCIA_MIN_APARICION = 150; // el ratón nunca reaparece más cerca que esto del gato
const TOPE_APRENDIZAJE = 100;       // a partir de aquí la IA del ratón ya no mejora más
const CAPTURAS_POR_NIVEL_IA = 5;    // capturas históricas necesarias para subir 1 nivel de "Amenaza I.A."

// La dificultad ahora SÍ afecta al ratón (antes solo cambiaba la velocidad del gato)
const DIFICULTADES = [
    { nombre: "Fácil",   velGato: 5, factorRaton: 0.8, factorVision: 0.8, monedasPorCaptura: 10 },
    { nombre: "Normal",  velGato: 5, factorRaton: 1.0, factorVision: 1.0, monedasPorCaptura: 20 },
    { nombre: "Difícil", velGato: 5, factorRaton: 1.2, factorVision: 1.15, monedasPorCaptura: 30 }
];

const SKINS = [
    { emoji: "🐱", nombre: "Gato",  precio: 0,   boton: "btn-gato" },
    { emoji: "🐯", nombre: "Tigre", precio: 100, boton: "btn-tigre" },
    { emoji: "🦁", nombre: "León",  precio: 500, boton: "btn-leon" }
];

// --- ALMACENAMIENTO SEGURO ---
// localStorage puede fallar (modo privado, datos corruptos). Estas funciones evitan que el juego se rompa.
function leerNumero(clave) {
    try {
        const n = Number(localStorage.getItem(clave));
        return Number.isFinite(n) ? n : 0;
    } catch (e) {
        return 0;
    }
}

function leerTexto(clave, porDefecto) {
    try {
        const valor = localStorage.getItem(clave);
        return valor !== null ? valor : porDefecto;
    } catch (e) {
        return porDefecto;
    }
}

function leerLista(clave, porDefecto) {
    try {
        const dato = JSON.parse(localStorage.getItem(clave));
        return Array.isArray(dato) ? dato : porDefecto;
    } catch (e) {
        return porDefecto;
    }
}

function guardar(clave, valor) {
    try {
        localStorage.setItem(clave, valor);
    } catch (e) {
        // Si no se puede guardar, el juego sigue funcionando (solo no recordará el progreso)
    }
}

// --- VARIABLES ---
let tiempo = DURACION_PARTIDA;
let puntos = 0;
let record = leerNumero("record");
let juegoIniciado = false;
let nivel = 1;
let dificultad = Math.min(3, Math.max(1, leerNumero("dificultad") || 1));
let velocidadGato = DIFICULTADES[dificultad - 1].velGato;
let monedas = leerNumero("monedas");
let monedasPartida = 0;
let skinsCompradas = leerLista("skinsCompradas", ["🐱"]);
if (!skinsCompradas.includes("🐱")) skinsCompradas.push("🐱");
let skinActual = leerTexto("skin", "🐱");
if (!skinsCompradas.includes(skinActual)) skinActual = "🐱"; // por si el dato guardado es inválido
let experienciaRaton = leerNumero("experienciaRaton");

let gato = { x: 300, y: 200, w: 35, h: 35 };
let raton = { x: 100, y: 100, w: 25, h: 25, targetX: null, targetY: null };

// Control del bucle y de las teclas
let animacionId = null;       // id del requestAnimationFrame actual (para no duplicar bucles)
let ultimoTimestamp = null;   // marca de tiempo del frame anterior
let ultimoSegundoMostrado = null;
const teclas = { arriba: false, abajo: false, izquierda: false, derecha: false };

// --- AVISOS EN PANTALLA (el cuadro dorado #logro, que antes no se usaba) ---
let temporizadorLogro = null;

function mostrarLogro(texto) {
    const elemento = document.getElementById("logro");
    if (!elemento) return;
    elemento.textContent = texto;
    elemento.style.right = "20px";
    clearTimeout(temporizadorLogro);
    temporizadorLogro = setTimeout(() => {
        elemento.style.right = "-400px";
    }, 2200);
}

// --- IA Y ACTUALIZACIÓN VISUAL ---
function actualizarNivelVisualIA() {
    // Ahora lee la variable en memoria (siempre está sincronizada con localStorage)
    let nivelIA = Math.floor(experienciaRaton / CAPTURAS_POR_NIVEL_IA) + 1;

    const elemento = document.getElementById("ia-nivel");
    if (elemento) {
        elemento.innerText = experienciaRaton >= TOPE_APRENDIZAJE ? nivelIA + " (MAX)" : nivelIA;
    }

    const elementoRecord = document.getElementById("record-valor");
    if (elementoRecord) elementoRecord.innerText = record;
}

// Pone en el marcador los valores reales (antes las monedas no se refrescaban al empezar)
function actualizarMarcador() {
    document.getElementById("puntos-valor").innerText = puntos;
    document.getElementById("monedas-valor").innerText = monedas;
    document.getElementById("nivel-valor").innerText = nivel;
    document.getElementById("tiempo-valor").innerText = Math.max(0, Math.ceil(tiempo));
}

// --- GESTOR CENTRAL DE PANTALLAS ---
const PANTALLAS = ["menu-inicio", "menu-ajustes", "menu-tienda", "fin-juego", "juego", "marcador"];

function cambiarPantalla(pantallaObjetivo) {
    // Apaga todas las pantallas
    PANTALLAS.forEach((id) => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.style.display = "none";
    });

    // Enciende solo la correspondiente
    if (pantallaObjetivo === "juego") {
        document.getElementById("juego").style.display = "block";
        document.getElementById("marcador").style.display = "flex";
    } else {
        const pantalla = document.getElementById(pantallaObjetivo);
        if (pantalla) pantalla.style.display = "block";
    }
}

// --- NAVEGACIÓN ---
function reaparecerRaton() {
    // Busca un punto aleatorio que no quede encima del gato
    const centroGatoX = gato.x + gato.w / 2;
    const centroGatoY = gato.y + gato.h / 2;

    for (let intento = 0; intento < 30; intento++) {
        const x = Math.random() * (canvas.width - raton.w);
        const y = Math.random() * (canvas.height - raton.h);
        const distancia = Math.hypot(x + raton.w / 2 - centroGatoX, y + raton.h / 2 - centroGatoY);
        if (distancia >= DISTANCIA_MIN_APARICION) {
            raton.x = x;
            raton.y = y;
            raton.targetX = null;
            raton.targetY = null;
            return;
        }
    }

    // Plan B (casi nunca ocurre): la esquina opuesta al gato
    raton.x = centroGatoX < canvas.width / 2 ? canvas.width - raton.w : 0;
    raton.y = centroGatoY < canvas.height / 2 ? canvas.height - raton.h : 0;
    raton.targetX = null;
    raton.targetY = null;
}

function empezarJuego() {
    // Si por algún motivo ya había un bucle corriendo, lo cancelamos para no tener dos a la vez
    if (animacionId !== null) {
        cancelAnimationFrame(animacionId);
        animacionId = null;
    }

    juegoIniciado = true;
    tiempo = DURACION_PARTIDA;
    puntos = 0;
    nivel = 1;
    monedasPartida = 0;
    ultimoTimestamp = null;
    ultimoSegundoMostrado = null;

    // Reinicia posiciones y teclas
    gato.x = canvas.width / 2 - gato.w / 2;
    gato.y = canvas.height / 2 - gato.h / 2;
    teclas.arriba = teclas.abajo = teclas.izquierda = teclas.derecha = false;
    reaparecerRaton();

    actualizarMarcador();
    cambiarPantalla("juego");
    animacionId = requestAnimationFrame(gameLoop);
}

function terminarJuego() {
    juegoIniciado = false;
    if (animacionId !== null) {
        cancelAnimationFrame(animacionId);
        animacionId = null;
    }

    // Récord: ahora se guarda de verdad
    const esRecord = puntos > record;
    if (esRecord) {
        record = puntos;
        guardar("record", record);
    }

    cambiarPantalla("fin-juego");
    document.getElementById("puntos-finales").innerText = puntos;
    document.getElementById("monedas-partida").innerText = monedasPartida;
    document.getElementById("record-final").innerText = record;
    document.getElementById("mensaje-record").style.display = esRecord ? "block" : "none";
    actualizarNivelVisualIA();
}

function reiniciarJuego() {
    empezarJuego();
}

function abrirAjustes() {
    cambiarPantalla("menu-ajustes");
}

function abrirTienda() {
    cambiarPantalla("menu-tienda");
    document.getElementById("monedas-tienda").innerText = monedas;
    actualizarBotonesTienda();
}

function volverMenu() {
    cambiarPantalla("menu-inicio");
    actualizarNivelVisualIA();
}

function actualizarTextoDificultad() {
    document.getElementById("btn-dificultad").innerText = `Dificultad: ${DIFICULTADES[dificultad - 1].nombre}`;
}

function cambiarDificultad() {
    dificultad = (dificultad % 3) + 1;
    velocidadGato = DIFICULTADES[dificultad - 1].velGato;
    guardar("dificultad", dificultad);
    actualizarTextoDificultad();
}

function borrarProgreso() {
    if (!confirm("¿Seguro? Se borrarán monedas, skins, récord y lo que ha aprendido el ratón.")) return;

    try {
        ["record", "monedas", "skin", "skinsCompradas", "experienciaRaton", "dificultad"].forEach((clave) => {
            localStorage.removeItem(clave);
        });
    } catch (e) {
        // Si no se puede borrar, igual reiniciamos las variables de esta sesión
    }

    record = 0;
    monedas = 0;
    skinsCompradas = ["🐱"];
    skinActual = "🐱";
    experienciaRaton = 0;
    dificultad = 1;
    velocidadGato = DIFICULTADES[0].velGato;

    actualizarTextoDificultad();
    actualizarNivelVisualIA();
    mostrarLogro("Progreso borrado");
}

// --- TIENDA Y SKINS ---
function actualizarBotonesTienda() {
    SKINS.forEach((skin) => {
        const boton = document.getElementById(skin.boton);
        if (!boton) return;

        if (skin.emoji === skinActual) {
            boton.innerText = `Equipado: ${skin.nombre}`;
        } else if (skinsCompradas.includes(skin.emoji)) {
            boton.innerText = `Equipar ${skin.nombre}`;
        } else {
            boton.innerText = `${skin.nombre} (${skin.precio} 💰)`;
        }
    });
}

function comprarOEquipar(emoji, precio) {
    if (skinsCompradas.includes(emoji)) {
        equiparSkin(emoji);
    } else if (monedas >= precio) {
        monedas -= precio;
        skinsCompradas.push(emoji);
        guardar("monedas", monedas);
        guardar("skinsCompradas", JSON.stringify(skinsCompradas));
        equiparSkin(emoji, "¡Compra exitosa! Skin equipada: " + emoji);
    } else {
        mostrarLogro(`Te faltan ${precio - monedas} monedas`);
    }
    document.getElementById("monedas-tienda").innerText = monedas;
    actualizarBotonesTienda();
}

function equiparSkin(emoji, mensaje) {
    skinActual = emoji;
    guardar("skin", skinActual);
    mostrarLogro(mensaje || "Skin equipada: " + emoji);
}

// --- LÓGICA DEL JUEGO ---
function actualizarGato(f) {
    // Dirección según las teclas que están pulsadas AHORA (movimiento continuo y suave)
    let dx = (teclas.derecha ? 1 : 0) - (teclas.izquierda ? 1 : 0);
    let dy = (teclas.abajo ? 1 : 0) - (teclas.arriba ? 1 : 0);

    // En diagonal se normaliza para que no sea más rápido que en línea recta
    if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
    }

    gato.x += dx * velocidadGato * f;
    gato.y += dy * velocidadGato * f;

    gato.x = Math.max(0, Math.min(canvas.width - gato.w, gato.x));
    gato.y = Math.max(0, Math.min(canvas.height - gato.h, gato.y));
}

function actualizarRaton(f) {
    const dif = DIFICULTADES[dificultad - 1];

    // Vector que va del gato hacia el ratón (la dirección en la que el ratón debe huir)
    const dx = (raton.x + raton.w / 2) - (gato.x + gato.w / 2);
    const dy = (raton.y + raton.h / 2) - (gato.y + gato.h / 2);
    const dist = Math.hypot(dx, dy);

    // Cuanto más ha cazado el jugador en total, más "aprende" el ratón
    const nivelAprendizaje = Math.min(experienciaRaton, TOPE_APRENDIZAJE);

    const radioVision = (180 + nivelAprendizaje * 1.5) * dif.factorVision;

    let vel = (2.2 + nivel * 0.3 + nivelAprendizaje * 0.012) * dif.factorRaton;
    // Tope: el ratón nunca es más rápido que el gato por mucho, así que siempre se le puede cazar
    vel = Math.min(vel, velocidadGato * 1.05);

    if (dist < radioVision) {
        // HUIDA
        let vx = dist > 0 ? dx / dist : 1;
        let vy = dist > 0 ? dy / dist : 0;

        // Si choca con una pared, desliza a lo largo de ella en vez de quedarse pegado
        const margen = 2;
        const bloqueadoX = (raton.x <= margen && vx < 0) || (raton.x >= canvas.width - raton.w - margen && vx > 0);
        const bloqueadoY = (raton.y <= margen && vy < 0) || (raton.y >= canvas.height - raton.h - margen && vy > 0);

        if (bloqueadoX && bloqueadoY) {
            // Está en una esquina: no tiene salida
            vx = 0;
            vy = 0;
        } else if (bloqueadoX) {
            vy = vy >= 0 ? 1 : -1;
            vx = 0;
        } else if (bloqueadoY) {
            vx = vx >= 0 ? 1 : -1;
            vy = 0;
        }

        raton.x += vx * vel * f;
        raton.y += vy * vel * f;
        raton.targetX = null;
        raton.targetY = null;
    } else {
        // PASEO ALEATORIO
        // (antes "!raton.targetX" fallaba si el objetivo era justo 0)
        if (raton.targetX === null || Math.random() < 0.02 * f) {
            raton.targetX = Math.random() * (canvas.width - 50);
            raton.targetY = Math.random() * (canvas.height - 50);
        }
        raton.x += (raton.targetX - raton.x) * 0.05 * f;
        raton.y += (raton.targetY - raton.y) * 0.05 * f;
    }

    raton.x = Math.max(0, Math.min(canvas.width - raton.w, raton.x));
    raton.y = Math.max(0, Math.min(canvas.height - raton.h, raton.y));
}

// La colisión ahora se revisa en CADA frame (antes solo al pulsar una tecla)
function revisarColision() {
    const distancia = Math.hypot(
        (gato.x + gato.w / 2) - (raton.x + raton.w / 2),
        (gato.y + gato.h / 2) - (raton.y + raton.h / 2)
    );
    if (distancia >= RADIO_CAPTURA) return;

    const dif = DIFICULTADES[dificultad - 1];

    puntos++;
    monedas += dif.monedasPorCaptura;
    monedasPartida += dif.monedasPorCaptura;
    experienciaRaton++;

    // Las monedas ahora se guardan al ganarlas (antes solo al comprar, y se perdían)
    guardar("monedas", monedas);
    guardar("experienciaRaton", experienciaRaton);

    // Subida de nivel: cada CAPTURAS_POR_NIVEL ratones
    const nivelNuevo = Math.floor(puntos / CAPTURAS_POR_NIVEL) + 1;
    if (nivelNuevo > nivel) {
        nivel = nivelNuevo;
        tiempo += BONUS_TIEMPO_NIVEL;
        mostrarLogro(`¡Nivel ${nivel}! +${BONUS_TIEMPO_NIVEL}s`);
    }

    actualizarMarcador();
    actualizarNivelVisualIA();
    reaparecerRaton();
}

function actualizarTiempo(dt) {
    tiempo -= dt;

    // Solo tocamos el HTML cuando cambia el número entero de segundos
    const segundos = Math.max(0, Math.ceil(tiempo));
    if (segundos !== ultimoSegundoMostrado) {
        ultimoSegundoMostrado = segundos;
        document.getElementById("tiempo-valor").innerText = segundos;
    }

    if (tiempo <= 0) terminarJuego();
}

// --- BUCLE PRINCIPAL DEL JUEGO ---
function gameLoop(timestamp) {
    if (!juegoIniciado) return;

    if (ultimoTimestamp === null) ultimoTimestamp = timestamp;
    // dt = segundos desde el frame anterior. Se limita a 0.1 para que, si la pestaña
    // estuvo en segundo plano, el juego no "salte" ni se acabe el tiempo de golpe.
    const dt = Math.min((timestamp - ultimoTimestamp) / 1000, 0.1);
    ultimoTimestamp = timestamp;
    // f = cuántos "frames a 60 FPS" equivale este frame; así la velocidad es igual en pantallas de 60 o 144 Hz
    const f = dt * 60;

    actualizarGato(f);
    actualizarRaton(f);
    revisarColision();
    dibujar();
    actualizarTiempo(dt);

    if (juegoIniciado) {
        animacionId = requestAnimationFrame(gameLoop);
    }
}

function dibujar() {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "40px Arial";
    ctx.fillText(skinActual, gato.x, gato.y + 35);
    ctx.fillText("🐭", raton.x, raton.y + 30);
}

// --- CONTROLES ---
const MAPA_TECLAS = {
    arrowup: "arriba",
    w: "arriba",
    arrowdown: "abajo",
    s: "abajo",
    arrowleft: "izquierda",
    a: "izquierda",
    arrowright: "derecha",
    d: "derecha"
};

window.addEventListener("keydown", (e) => {
    const direccion = MAPA_TECLAS[e.key.toLowerCase()];
    if (!direccion || !juegoIniciado) return;
    e.preventDefault(); // evita que las flechas hagan scroll en la página
    teclas[direccion] = true;
});

window.addEventListener("keyup", (e) => {
    const direccion = MAPA_TECLAS[e.key.toLowerCase()];
    if (direccion) teclas[direccion] = false;
});

// Si la ventana pierde el foco con una tecla pulsada, el gato no se queda "atascado" caminando
window.addEventListener("blur", () => {
    teclas.arriba = teclas.abajo = teclas.izquierda = teclas.derecha = false;
});

// Inicialización automática de la interfaz al cargar
actualizarTextoDificultad();
actualizarNivelVisualIA();
