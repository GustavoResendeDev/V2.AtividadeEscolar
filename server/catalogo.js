/* Cache em memória do catálogo (serviços e barbeiros), por um tempo curto.
   Cada cópia do Worker guarda a sua; uma mudança no banco aparece em no máximo `validadeMs`. */
function criarCatalogo({ validadeMs = 60_000, agora = () => Date.now() } = {}) {
  const guardados = new Map();
  return {
    async obter(chave, carregar) {
      const item = guardados.get(chave);
      if (item && agora() - item.em < validadeMs) return item.valor;
      const valor = await carregar();
      guardados.set(chave, { valor, em: agora() });
      return valor;
    },
    limpar: () => guardados.clear(),
  };
}

// Sem cache (padrão nos testes e no npm start): sempre lê do banco.
const semCache = { obter: (chave, carregar) => carregar(), limpar() {} };

module.exports = { criarCatalogo, semCache };
