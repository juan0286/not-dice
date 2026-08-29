# Not Dice - Notas de la Versión

## 🚀 Actualización v2.13.26 (29 de Agosto de 2026)

Esta versión introduce importantes herramientas de diagnóstico remoto, protección contra errores comunes de apuntado en combate, compatibilidad ampliada con D&D 2024 / D&D5e v5.x y opciones de personalización para el GM.

---

### 📡 1. Gestor Centralizado de Logging y Diagnóstico Remoto
* **Logger Unificado (`notDiceLogger`)**: Sistema de logging estructurado con badges visuales para `debug`, `info`, `warn` y `error`.
* **Retransmisión en Tiempo Real a 'Juan'**: Si el usuario *Juan* está conectado a la sesión, cualquier error, traza o aviso originado en el navegador de cualquier jugador se retransmite automáticamente por socket a la consola de Juan con el prefijo `{NombreJugador}`.
* **Captura de Notificaciones en Pantalla**: Cada mensaje flotante (`ui.notifications`) emitido por el módulo se registra automáticamente como log en consola y se sincroniza en tiempo real.
* **Historial en Memoria**: Registro de los últimos 100 eventos (`globalThis.notDiceLogger.getHistory()`) para auditoría y depuración.
* **Ajuste de Depuración**: Opción para habilitar logs detallados (`enableDebugLogs`).

---

### ⚔️ 2. Automatización y Compatibilidad de Combate
* **Soporte para Hechizo Hex / Maleficio**: Detección automática del efecto de *Hex* (*Maleficio / Maldición*) en el objetivo proveniente del atacante, inyectando automáticamente el `1d6` de daño necrótico adicional.
* **Fix de Compatibilidad en `D20Roll`**: Estructuración correcta de términos de dado (`Die` de 20 caras) en ataques silenciosos, solucionando fallos con `automated-conditions-5e` y el hook `dnd5e.rollAttack`.
* **Selección de Objetivo en Celda Compartida**: Si un jugador ataca a un objetivo que se superpone o comparte celda con otros actores, se abre un diálogo previo con las tarjetas de los personajes presentes para elegir el objetivo correcto antes de disparar el ataque. *(Configurable vía `enableSharedCellTargetPrompt`)*.
* **Ignorar Delay de Ataque para el GM**: Nueva opción configurable (`ignoreAttackDelayForGM`, activada por defecto) que permite al GM encadenar ataques consecutivos sin tiempos de espera.

---

### 💚 3. Mejoras en el Sistema de Curación
* **Advertencia de Objetivo No Amistoso**: Al curar a un objetivo clasificado como *Hostil* o *Neutral*, el sistema abre un diálogo de confirmación visual para elegir entre redirigir la curación a uno mismo o mantener el objetivo enemigo. *(Configurable vía `enableHealingTargetWarning`)*.
* **Rediseño del Botón de Lanzamiento**: Botón de dados más grande, centrado y con estilo verde esmeralda brillante, acompañado de animaciones de giro y pulso luminoso en el resultado obtenido.

---

### 👑 4. Notificaciones de Maestrías de Armas en el Chat
* **Tarjetas Informativas de Maestría**: Publicación automática de tarjetas en el chat al aplicar maestrías sobre objetivos (*Debilitar, Derribar, Empujar, Molestar, Ralentizar, Rozar, Hender, Mellar*).
* **Configuración Individual**: Posibilidad de activar o desactivar estas tarjetas en el chat mediante el ajuste `enableMasteryChatMessages`.

---

## v2.13.13

### ⚔️ Tiradas e Interacciones de Chat
* **Tiradas Persistentes en Chat**: Las tiradas de dados y confirmaciones ahora se registran y permanecen legibles en el chat para la auditoría de los jugadores.
* **Ventana de Daño desde el Chat**: Al hacer clic en el botón de daño en la tarjeta de ataque del chat, se despliega automáticamente la caja de daño personalizada, facilitando la elección del tipo de daño o daño crítico.
* **Botones Rápidos de Ventaja/Desventaja**: Se añadieron botones rápidos directamente en la tarjeta de chat para aplicar ventaja o desventaja.
* **Estética de Chat Mejorada**: Se corrigieron los estilos de las tarjetas de chat para evitar que las imágenes de los íconos se estiren, manteniendo un encuadre perfecto de 36x36px acorde al diseño nativo.
* **Dados en 3D de Colores por Daño**: Integración de colores temáticos para los dados físicos 3D según el tipo de daño activo.

### 🩸 Panel Unificado de Resolución de Daño (GM)
* **Caja de Daño Personalizada y Moderna**: Un panel centralizado para resolver y aplicar daño a múltiples objetivos.
  * **Habilidades y Daño Extra Integrado**: Nuevo menú flotante para el GM que detecta automáticamente los bonificadores y habilidades del atacante (Sneak Attack, Hunter's Mark, Divine Smite, etc.) y permite agregarlos como daño extra con un solo clic.
  * **Consumo de Espacios de Conjuro**: Al aplicar un daño extra proveniente de un hechizo (ej. Absorb Elements, Hail of Thorns), se abre un cuadro de diálogo integrado que recalcula el daño automáticamente según el nivel de ranura elegido y descuenta el espacio de conjuro correspondiente de la hoja del actor.
  * **Daño Escalable Automático**: El sistema detecta y calcula inteligentemente las habilidades que escalan por nivel (como el Sneak Attack del Pícaro) para mostrar los dados correctos.
  * **Dados y Bonos Rápidos**: Botones interactivos para añadir dados extra a la fórmula o escribir bonificadores planos sobre la marcha.
  * **Control de Lanzamiento**: Los daños adicionales agregados por el GM no se lanzan automáticamente, permitiendo total control manual sobre qué daños aplicar y cuándo tirar los dados.
  * **Tipos de Daño**: Soporte completo para todos los tipos de daño del juego en la caja moderna.
  * **Daño Versátil (A Dos Manos)**: Opción rápida para alternar automáticamente al daño versátil de las armas.
  * **Medidor de Daño Relativo**: Barra de salud visual que muestra la cantidad de daño a recibir en proporción con los puntos de golpe máximos del objetivo.
  * **Caja Simplificada para Curación**: Si la tirada es de tipo curación (`healing`) o puntos de golpe temporales (`temphp`), el diálogo se simplifica dinámicamente y cambia su etiqueta a "Aplicar Curación".
  * **Tipo de Daño Elegido por el Jugador**: Si el jugador modifica o elige un tipo de daño específico al rodar, este se traslada y aplica automáticamente a la caja de daño del GM.

### 👑 Sistema de Maestrías de Armas (D&D 2024)
* **Descripciones de Maestrías en Hover**: Los botones de activación de maestrías ahora incluyen un tooltip interactivo (`cursor: help`) con su descripción oficial en español al pasar el cursor por encima (*Debilitar, Derribar, Empujar, Hender, Mellar, Molestar, Ralentizar, Rozar*).
* **Tirada de Salvación en Derribar (Topple)**: Si se aplica la maestría *Derribar*, el diálogo del GM muestra un botón rápido para solicitar automáticamente la tirada de salvación de Constitución al objetivo.
* **Habilidades Especiales en Daño**: Botones de acceso rápido para habilidades de combate en la tarjeta del jugador (como *Atacante Salvaje* o *Maestro en Armas Pesadas*).

### ⚙️ Ajustes y Compatibilidad
* **Restricción de Ajustes**: Las configuraciones sensibles son exclusivas del GM. Los jugadores solo tienen acceso a la configuración del sonido de dados y la personalización de sus colores de dados.
* **Ocultar Epic Rolls**: La opción de tirada "Epic" se elimina automáticamente de la interfaz si el módulo *Epic Rolls* no está activo en la partida.
