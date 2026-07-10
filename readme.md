# Not Dice - Notas de la Versión v2.13.13

Esta versión presenta mejoras significativas en la automatización del combate, el panel de resolución de daño del GM, soporte avanzado para habilidades y hechizos, y una interfaz visual pulida.

---

## ⚔️ Tiradas e Interacciones de Chat
* **Tiradas Persistentes en Chat**: Las tiradas de dados y confirmaciones ahora se registran y permanecen legibles en el chat para la auditoría de los jugadores.
* **Ventana de Daño desde el Chat**: Al hacer clic en el botón de daño en la tarjeta de ataque del chat, se despliega automáticamente la caja de daño personalizada, facilitando la elección del tipo de daño o daño crítico.
* **Botones Rápidos de Ventaja/Desventaja**: Se añadieron botones rápidos directamente en la tarjeta de chat para aplicar ventaja o desventaja.
* **Estética de Chat Mejorada**: Se corrigieron los estilos de las tarjetas de chat para evitar que las imágenes de los íconos se estiren, manteniendo un encuadre perfecto de 36x36px acorde al diseño nativo.
* **Dados en 3D de Colores por Daño**: Integración de colores temáticos para los dados físicos 3D según el tipo de daño activo (ej. rojo para fuego, azul para frío, amarillo para electricidad, etc.).

## 🩸 Panel Unificado de Resolución de Daño (GM)
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

## 👑 Sistema de Maestrías de Armas (D&D 2024)
* **Descripciones de Maestrías en Hover**: Los botones de activación de maestrías ahora incluyen un tooltip interactivo (`cursor: help`) con su descripción oficial en español al pasar el cursor por encima (*Debilitar, Derribar, Empujar, Hender, Mellar, Molestar, Ralentizar, Rozar*).
* **Tirada de Salvación en Derribar (Topple)**: Si se aplica la maestría *Derribar*, el diálogo del GM muestra un botón rápido para solicitar automáticamente la tirada de salvación de Constitución al objetivo.
* **Habilidades Especiales en Daño**: Botones de acceso rápido para habilidades de combate en la tarjeta del jugador (como *Atacante Salvaje* o *Maestro en Armas Pesadas*). El relanzamiento de *Atacante Salvaje* se restringe automáticamente para que solo aplique a armas físicas.

## 🎨 Estética e Interfaz de Usuario
* **Cabecera Detallada en Resolución**: El cuadro de diálogo de daño del GM incluye el avatar y nombre del atacante.
* **Agrupamiento Inteligente**: Las tarjetas de objetivos se agrupan de forma compacta para optimizar el espacio vertical de la pantalla.
* **Fórmula de Daño Ampliada**: La caja que muestra la fórmula en el desglose de daño ahora es más grande (`font-size: 1.25em; font-weight: 800`) y con bordes contrastados para máxima legibilidad.

## ⚙️ Ajustes y Compatibilidad
* **Restricción de Ajustes**: Las configuraciones sensibles son exclusivas del GM. Los jugadores solo tienen acceso a la configuración del sonido de dados y la personalización de sus colores de dados.
* **Ocultar Epic Rolls**: La opción de tirada "Epic" se elimina automáticamente de la interfaz si el módulo *Epic Rolls* no está activo en la partida.

---

## 🔧 Correcciones y Fixes
* **Fix de Enemigo Predilecto (Favored Enemy)**: Corrección de un problema de mapeo en D&D 2024 donde la fórmula base no se leía bien; ahora fuerza dinámicamente `1d6` cuando corresponde.
* **Limitación de Maestrías por Personaje**: Se corrigió el error que mostraba opciones de maestría en el diálogo de ataque aun si el personaje no poseía el rasgo de maestría correspondiente para esa arma. Ahora solo aparecen si el actor la tiene entrenada.
* **Eliminación de Epic para no-invitados**: Remoción de los actores que no están marcados para la tirada de Epic.
* **Fix de Inicialización (`enableModule`)**: Se eliminó la dependencia de la propiedad obsoleta `enableModule` en el hook `ready`, solventando los errores de inicialización del módulo al cargar Foundry VTT.
