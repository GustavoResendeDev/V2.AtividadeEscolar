/* Aviso por e-mail (Resend) para a barbearia quando um cliente agenda pelo site.
   Variáveis: RESEND_API_KEY, EMAIL_AVISO_PARA (quem recebe) e EMAIL_REMETENTE (opcional).
   Sem domínio verificado no Resend, o remetente precisa ser onboarding@resend.dev e o
   destinatário só pode ser o e-mail da própria conta do Resend. */

const escapar = (texto) =>
  String(texto).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function montarAviso(a, { urlPainel } = {}) {
  const preco = `R$ ${a.preco.toFixed(2).replace(".", ",")}`;
  const [ano, mes, dia] = a.data.split("-");
  const linhas = [
    ["Código", a.codigo],
    ["Cliente", a.cliente.nome],
    ["WhatsApp", a.cliente.telefone],
    [a.servico.quantidade > 1 ? "Serviços" : "Serviço", a.servico.nome],
    ["Valor", preco],
    ["Data", `${dia}/${mes}/${ano}`],
    ["Horário", `${a.hora} às ${a.termino}`],
    ["Barbeiro", a.barbeiro.nome],
  ];
  const texto = [
    "Novo agendamento pelo site (a confirmar)",
    "",
    ...linhas.map(([k, v]) => `${k}: ${v}`),
    ...(urlPainel ? ["", `Confirme no painel: ${urlPainel}`] : []),
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
<p><strong>Novo agendamento pelo site</strong> (a confirmar)</p>
<table cellpadding="6" style="border-collapse:collapse">${linhas
    .map(([k, v]) => `<tr><td style="color:#555">${escapar(k)}</td><td><strong>${escapar(v)}</strong></td></tr>`)
    .join("")}</table>
${urlPainel ? `<p><a href="${escapar(urlPainel)}">Abrir o painel para confirmar</a></p>` : ""}
</div>`;
  return {
    assunto: `Novo agendamento: ${a.cliente.nome}, ${dia}/${mes} às ${a.hora}`,
    texto,
    html,
  };
}

async function enviarAviso(env, agendamento, { urlPainel, fetch: buscar = fetch } = {}) {
  if (!env.RESEND_API_KEY || !env.EMAIL_AVISO_PARA) return false;
  const { assunto, texto, html } = montarAviso(agendamento, { urlPainel });
  const resposta = await buscar("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_REMETENTE || "Nova Era Barbearia <onboarding@resend.dev>",
      to: env.EMAIL_AVISO_PARA.split(",").map((e) => e.trim()).filter(Boolean),
      subject: assunto,
      text: texto,
      html,
    }),
  });
  if (!resposta.ok) throw new Error(`Resend respondeu ${resposta.status}: ${await resposta.text()}`);
  return true;
}

module.exports = { enviarAviso, montarAviso };
