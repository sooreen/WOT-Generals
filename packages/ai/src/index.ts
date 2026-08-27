// Браузеробезопасная часть пакета: программные оппоненты и описание позиции.
// Агент на нейросети экспортируется отдельно (@wotg/ai/llm), потому что тянет
// SDK Anthropic с зависимостями от Node — в клиентскую сборку он попадать не должен.

export * from './types.js';
export * from './evaluate.js';
export * from './agents.js';
export * from './describe.js';
export * from './factory.js';
