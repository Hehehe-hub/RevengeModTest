(function () {
  "use strict";

  const { findByProps } = vendetta.metro;
  const patcher = vendetta.patcher;

  // ===== Configurações =====
  const NOME_BOT = "GhatPrime-InRevenge";
  const RODAPE = "-# ||Mod feito por **AlphaGhat!**||";
  // true = suas respostas do /sus não aparecem no chat (só o plugin lê)
  const ESCONDER_RESPOSTAS = true;
  const KEY = "ALPHACORD_SUSPEITOS_V1";
  const TEMPLATE = [
    "Nome: ||coloque o nome aqui||",
    "Principal suspeito? ||(mande 1 se for Sim e 2 se for Não)||",
    "Tag: ||coloque um emoji aqui||",
    "Motivo: ||Coloque o motivo pela qual ele está como suspeito||",
    RODAPE,
  ].join("\n");

  const MA = findByProps("sendMessage", "receiveMessage");
  const unregs = [];
  let unpatchSend = null;
  let db = { nextNum: 1, items: [] };
  let pending = null;
  let internal = false;
  let mmkvReadable = false;
  let ready = Promise.resolve();
  let saving = Promise.resolve();

  // ===== Armazenamento (nunca apaga nada sozinho) =====
  function mmkv() {
    try {
      return (globalThis.nativeModuleProxy || {}).MMKVManager || null;
    } catch (e) {
      return null;
    }
  }

  function mergeDbs(list) {
    const map = {};
    let nextNum = 1;
    list.forEach(function (d) {
      if (!d || !Array.isArray(d.items)) return;
      nextNum = Math.max(nextNum, d.nextNum || 1);
      d.items.forEach(function (it) {
        const cur = map[it.uid];
        if (!cur || (it.editadoEm || 0) > (cur.editadoEm || 0)) map[it.uid] = it;
      });
    });
    const items = Object.keys(map)
      .map(function (k) { return map[k]; })
      .sort(function (a, b) { return a.num - b.num; });
    items.forEach(function (it) { nextNum = Math.max(nextNum, it.num + 1); });
    return { nextNum: nextNum, items: items };
  }

  async function loadDb() {
    const found = [];
    const m = mmkv();
    try {
      if (m) {
        const raw = await m.getItem(KEY);
        mmkvReadable = true;
        if (raw) found.push(JSON.parse(raw));
      }
    } catch (e) {
      mmkvReadable = false; // não sobrescreve se não conseguiu ler
    }
    try {
      const raw = vendetta.plugin.storage.dbJson;
      if (raw) found.push(JSON.parse(raw));
    } catch (e) {}
    db = mergeDbs(found);
    if (found.length) await saveDb();
  }

  async function doSave() {
    const json = JSON.stringify(db);
    let ok = false;
    try {
      const m = mmkv();
      if (m && mmkvReadable) {
        const prev = await m.getItem(KEY);
        if (prev) await m.setItem(KEY + "_ANTERIOR", prev);
        await m.setItem(KEY, json);
        ok = true;
      }
    } catch (e) {}
    try {
      vendetta.plugin.storage.dbJson = json;
      ok = true;
    } catch (e) {}
    return ok;
  }

  function saveDb() {
    saving = saving.then(doSave);
    return saving;
  }

  // ===== Utilidades =====
  function toast(t) {
    try { vendetta.ui.toasts.showToast(t); } catch (e) {}
  }

  function clean(t) {
    return String(t).replace(/`/g, "´").replace(/\s*\n\s*/g, " ");
  }
  function cap(t) {
    t = String(t);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function norm(t) {
    return String(t == null ? "" : t).replace(/[\uFE0F\s]/g, "").replace(/^tag:/i, "").toLowerCase();
  }

  function chunk(text) {
    const parts = [];
    let cur = "";
    text.split("\n\n").forEach(function (block) {
      if (cur && (cur + "\n\n" + block).length > 1900) {
        parts.push(cur);
        cur = block;
      } else {
        cur = cur ? cur + "\n\n" + block : block;
      }
    });
    if (cur) parts.push(cur);
    const final = [];
    parts.forEach(function (p) {
      (p.match(/[\s\S]{1,1900}/g) || []).forEach(function (x) { final.push(x); });
    });
    return final;
  }

  // ===== Envio de mensagens =====
  // Mensagem local (só você vê), com nome de bot
  function botMsg(channelId, content) {
    try {
      const CB = findByProps("createBotMessage");
      if (CB && MA && MA.receiveMessage) {
        const m = CB.createBotMessage({ channelId: channelId, content: content, embeds: [] });
        try { m.author.username = NOME_BOT; } catch (e) {}
        MA.receiveMessage(channelId, m);
        return;
      }
    } catch (e) {}
    try {
      MA.sendBotMessage(channelId, content);
      return;
    } catch (e) {}
    toast(content.slice(0, 100));
  }

  // Mensagem de verdade, na sua conta
  function sendReal(channelId, content) {
    internal = true;
    try {
      MA.sendMessage(channelId, { content: content, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] });
    } finally {
      internal = false;
    }
  }

  function out(c, text) {
    chunk(text).forEach(function (p) {
      if (c.viaPrefix && !c.local && MA) sendReal(c.channelId, p);
      else botMsg(c.channelId, p);
    });
  }

  // ===== Formatação =====
  function fmt(s) {
    return [
      "Suspeito #" + s.num + ":",
      "Nome do suspeito: `" + clean(cap(s.nome)) + "`",
      s.principal ? "É o principal suspeito" : "Não é o principal suspeito",
      "Tag: `" + clean(s.tag) + "`",
      'Motivo: `"' + clean(s.motivo) + '"`',
    ].join("\n");
  }

  function listText(items) {
    if (!items.length) return "Nenhum suspeito salvo ainda. Use `/sus`!\n" + RODAPE;
    const blocks = items.map(fmt);
    blocks[blocks.length - 1] += "\n" + RODAPE;
    return blocks.join("\n\n");
  }

  // ===== Fluxo de cadastro / edição / exclusão =====
  function startFlow(ctx, mode, base) {
    pending = {
      channelId: ctx.channelId,
      viaPrefix: ctx.viaPrefix,
      mode: mode,
      uid: base ? base.uid : null,
      step: 0,
      data: base ? { nome: base.nome, principal: base.principal, tag: base.tag, motivo: base.motivo } : {},
      expira: Date.now() + 10 * 60 * 1000,
    };
  }

  function applyAnswer(st, raw) {
    const v = raw.trim();
    const keep = st.mode === "edit" && v === "-";
    if (!keep) {
      if (st.step === 1) {
        if (v !== "1" && v !== "2") return "Principal suspeito: mande só 1 (Sim) ou 2 (Não). Tente de novo.";
        st.data.principal = v === "1";
      } else {
        if (!v) return "Esse campo não pode ficar vazio.";
        st.data[["nome", "principal", "tag", "motivo"][st.step]] = v;
      }
    }
    st.step++;
    return null;
  }

  async function handleAnswer(st, text) {
    st.expira = Date.now() + 10 * 60 * 1000;

    if (st.mode === "del") {
      pending = null;
      if (!/^(sim|s)$/i.test(text)) return out(st, "Exclusão cancelada.");
      await ready;
      const antes = db.items.length;
      db.items = db.items.filter(function (i) { return i.uid !== st.uid; });
      if (db.items.length === antes) return out(st, "Esse suspeito já não existe.");
      const okDel = await saveDb();
      return out(st, okDel ? "Suspeito excluído." : "⚠️ Excluí só na memória; não consegui gravar.");
    }

    const lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    while (lines.length && st.step < 4) {
      const raw = st.step === 3 ? lines.splice(0).join(" ") : lines.shift();
      const erro = applyAnswer(st, raw);
      if (erro) return out(st, erro);
    }
    if (st.step < 4) return;

    pending = null;
    await ready;
    if (st.mode === "edit") {
      const s = db.items.find(function (i) { return i.uid === st.uid; });
      if (!s) return out(st, "Não achei mais esse suspeito.");
      Object.assign(s, st.data, { editadoEm: Date.now() });
    } else {
      db.items.push(
        Object.assign(
          { uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), num: db.nextNum++ },
          st.data,
          { criadoEm: Date.now(), editadoEm: Date.now() }
        )
      );
    }
    const ok = await saveDb();
    out(
      st,
      ok
        ? st.mode === "edit" ? "Suspeito atualizado!" : "Suspeito salvo! Use `/versus`!"
        : "⚠️ Não consegui gravar no armazenamento. Fica só na memória até fechar o app!"
    );
  }

  function pick(ctx, args) {
    const tag = norm(args.tag);
    if (!tag) {
      out(ctx, "Me diga a tag. Ex.: `/editarsus tag:🥶`");
      return null;
    }
    let found = db.items.filter(function (i) { return norm(i.tag) === tag; });
    if (args.numero) {
      const n = parseInt(String(args.numero).replace(/\D/g, ""), 10);
      found = found.filter(function (i) { return i.num === n; });
    }
    if (!found.length) {
      out(ctx, "Nenhum suspeito encontrado com essa tag" + (args.numero ? " e número." : "."));
      return null;
    }
    if (found.length > 1) {
      out(ctx, "Achei " + found.length + " suspeitos com essa tag. Repita o comando adicionando `numero:N`.\n\n" + listText(found));
      return null;
    }
    return found[0];
  }

  // ===== Comandos (o /help lê esta lista sozinho) =====
  const CMDS = [
    {
      name: "help",
      aliases: ["help", "ajuda"],
      local: true,
      desc: "Mostra todos os comandos do Alphacord",
      run: function (ctx) {
        const linhas = CMDS.map(function (c) {
          const pre = "`." + c.aliases.join("` / `.") + "`";
          return "• " + (c.noSlash ? pre : "`/" + c.name + "` ou " + pre) + (c.usage ? " " + c.usage : "") + " — " + c.desc;
        });
        out(ctx, ["**Alphacord — comandos**"].concat(linhas).join("\n") + "\n" + RODAPE);
      },
    },
    {
      name: "sus",
      aliases: ["sus"],
      desc: "Cadastra um suspeito (nome, principal, tag e motivo)",
      run: function (ctx) {
        startFlow(ctx, "new", null);
        out(ctx, TEMPLATE);
      },
    },
    {
      name: "versus",
      aliases: ["versus"],
      desc: "Mostra a lista de suspeitos",
      run: function (ctx) {
        out(ctx, listText(db.items));
      },
    },
    {
      name: "pesquisarsus",
      aliases: ["pessus", "pesquisarsus"],
      desc: "Pesquisa suspeitos por tag",
      usage: "tag:🥶",
      options: [{ name: "tag", desc: "Tag (emoji) para pesquisar", required: true }],
      run: function (ctx, args) {
        const tag = norm(args.tag);
        if (!tag) return out(ctx, "Use: `/pesquisarsus tag:🥶` ou `.pessus 🥶`");
        const found = db.items.filter(function (i) { return norm(i.tag) === tag; });
        out(ctx, found.length ? listText(found) : "Nenhum suspeito com a tag " + args.tag + ".");
      },
    },
    {
      name: "editarsus",
      aliases: ["editsus", "editarsus"],
      desc: "Edita um suspeito pela tag (use - para manter um campo)",
      usage: "tag:🥶",
      options: [
        { name: "tag", desc: "Tag do suspeito", required: true },
        { name: "numero", desc: "Número, se houver mais de um com a mesma tag", required: false },
      ],
      run: function (ctx, args) {
        const s = pick(ctx, args);
        if (!s) return;
        startFlow(ctx, "edit", s);
        out(
          ctx,
          "Editando o suspeito #" + s.num + ". Mande os novos valores (um por mensagem, ou os 4 juntos). Use `-` para manter o valor atual.\n\n" +
            fmt(s) + "\n\n" + TEMPLATE
        );
      },
    },
    {
      name: "excluirsus",
      aliases: ["exclsus", "excluirsus"],
      desc: "Exclui um suspeito pela tag (pede confirmação)",
      usage: "tag:🥶",
      options: [
        { name: "tag", desc: "Tag do suspeito", required: true },
        { name: "numero", desc: "Número, se houver mais de um com a mesma tag", required: false },
      ],
      run: function (ctx, args) {
        const s = pick(ctx, args);
        if (!s) return;
        pending = {
          channelId: ctx.channelId,
          viaPrefix: ctx.viaPrefix,
          mode: "del",
          uid: s.uid,
          expira: Date.now() + 10 * 60 * 1000,
        };
        out(ctx, "Excluir o suspeito #" + s.num + " (" + clean(cap(s.nome)) + ")? Mande `sim` para confirmar. Qualquer outra coisa cancela.");
      },
    },
    {
      name: "tweet",
      aliases: ["tweet", "paginas", "anotacoes"],
      desc: "Abre o Tweet (suas anotações privadas e ferramentas)",
      run: function (ctx) {
        abrirTweet(ctx);
      },
    },
    cmdServidor(["criar canal"], "Cria um canal de texto, voz ou tópicos", '"nome" texto em Categoria', wikiCanal(), doCriarCanal),
    cmdServidor(
      ["deletar canal"], "Deleta um canal (pede confirmação)", '"nome"',
      '**.deletar canal**\nUse: `.deletar canal "nome-do-canal"`\nVocê confirma numa telinha antes de apagar.',
      function (ctx, raw) { return doDeletarCanal(ctx, raw, [0, 2, 5, 13, 15], "canal"); }
    ),
    cmdServidor(
      ["criar categoria"], "Cria uma categoria", "Nome",
      '**.criar categoria**\nUse: `.criar categoria Comunidade`\nDepois crie canais nela com `.criar canal "chat-geral" texto em Comunidade`.',
      doCriarCategoria
    ),
    cmdServidor(
      ["deletar categoria"], "Deleta uma categoria (pede confirmação)", "Nome",
      '**.deletar categoria**\nUse: `.deletar categoria Comunidade`\nOs canais dentro dela não são apagados. Você confirma numa telinha antes.',
      function (ctx, raw) { return doDeletarCanal(ctx, raw, [4], "categoria"); }
    ),
    cmdServidor(["criar cargo"], "Cria um cargo", '"Nome" 2 #random', wikiCargo(), doCriarCargos),
    cmdServidor(["criar cargos"], "Cria vários cargos de uma vez (bloco de código)", "uma linha por cargo", wikiCargos(), doCriarCargos),
    cmdServidor(
      ["deletar cargo"], "Deleta um cargo (pede confirmação)", '"Nome"',
      '**.deletar cargo**\nUse: `.deletar cargo "Nome do cargo"`\nVocê confirma numa telinha antes de apagar.',
      doDeletarCargo
    ),
    {
      name: "wiki",
      aliases: ["wiki"],
      desc: "Mostra exatamente como usar um comando",
      usage: '"criar canal"',
      local: true,
      raw: true,
      options: [{ name: "comando", desc: "Nome do comando, ex.: criar canal", required: true }],
      run: function (ctx, args) {
        const q = chave(String(args.raw || args.comando || "")).replace(/["“”]/g, "").replace(/^[./]/, "").replace(/\s+/g, " ").trim();
        if (!q) return out(ctx, 'Use: `.wiki "criar canal"`. Veja os nomes com `.help`.');
        const c = CMDS.find(function (x) { return x.name === q || x.aliases.indexOf(q) >= 0; });
        if (!c) return out(ctx, 'Não achei o comando "' + q + '". Use `.help` para ver a lista.');
        out(ctx, c.wiki || "Para usar: `." + c.aliases[0] + "`" + (c.usage ? " " + c.usage : "") + "\n" + c.desc);
      },
    },
  ];

  async function run(c, ctx, args) {
    try {
      await ready;
      await c.run(ctx, args || {});
    } catch (e) {
      out(ctx, "Erro no Alphacord: " + ((e && e.message) || e));
    }
  }

  function parseArgs(text) {
    const res = {};
    const pos = [];
    (text || "").trim().split(/\s+/).filter(Boolean).forEach(function (tok) {
      const m = tok.match(/^(tag|numero|n):(.*)$/i);
      if (m) res[m[1].toLowerCase() === "tag" ? "tag" : "numero"] = m[2];
      else pos.push(tok);
    });
    if (!res.tag && pos.length) res.tag = pos.shift();
    if (!res.numero && pos.length) res.numero = pos.shift();
    return res;
  }

  // ===== Comandos com ponto (.sus, .help...) e respostas do fluxo =====
  function onSend(args, orig) {
    try {
      if (internal) return orig.apply(null, args);
      const channelId = args[0];
      const msg = args[1];
      const text = msg && typeof msg.content === "string" ? msg.content.trim() : "";
      if (!text) return orig.apply(null, args);

      if (pending && pending.expira < Date.now()) pending = null;

      if (pending && pending.channelId === channelId && /^\.?cancelar$/i.test(text)) {
        const p = pending;
        pending = null;
        out(p, "Cancelado.");
        return Promise.resolve();
      }

      const hit = matchPrefix(text);
      if (hit) {
        pending = null;
        run(hit.cmd, { channelId: channelId, viaPrefix: true, local: !!hit.cmd.local }, hit.cmd.raw ? { raw: hit.rest } : parseArgs(hit.rest));
        return Promise.resolve();
      }

      if (pending && pending.channelId === channelId) {
        const p = pending;
        handleAnswer(p, text).catch(function (e) {
          out(p, "Erro no Alphacord: " + ((e && e.message) || e));
        });
        return ESCONDER_RESPOSTAS ? Promise.resolve() : orig.apply(null, args);
      }
    } catch (e) {}
    return orig.apply(null, args);
  }

  // ===== Aba Páginas: gerenciador privado de anotações =====
  const React = vendetta.metro.common.React;
  const RN = vendetta.metro.common.ReactNative;
  const h = React.createElement;
  const PKEY = "ALPHACORD_PAGINAS_V1";
  const ALERT_KEY = "alphacord-paginas";
  let paginas = { nodes: [] };
  let paginasOk = false;
  let paginasReady = Promise.resolve();
  let paginasSaving = Promise.resolve();
  let paginasTimer = null;

  function mergeNodes(list) {
    const map = {};
    list.forEach(function (d) {
      if (!d || !Array.isArray(d.nodes)) return;
      d.nodes.forEach(function (n) {
        const cur = map[n.uid];
        if (!cur || (n.editadoEm || 0) > (cur.editadoEm || 0)) map[n.uid] = n;
      });
    });
    return { nodes: Object.keys(map).map(function (k) { return map[k]; }) };
  }

  async function loadPaginas() {
    const found = [];
    const m = mmkv();
    try {
      if (m) {
        const raw = await m.getItem(PKEY);
        paginasOk = true;
        if (raw) found.push(JSON.parse(raw));
      }
    } catch (e) {
      paginasOk = false; // não sobrescreve se não conseguiu ler
    }
    try {
      const raw = vendetta.plugin.storage.paginasJson;
      if (raw) found.push(JSON.parse(raw));
    } catch (e) {}
    paginas = mergeNodes(found);
    if (found.length) await savePaginas();
  }

  async function doSavePaginas() {
    const json = JSON.stringify(paginas);
    let ok = false;
    try {
      const m = mmkv();
      if (m && paginasOk) {
        const prev = await m.getItem(PKEY);
        if (prev) {
          let antes = 0;
          try { antes = JSON.parse(prev).nodes.length; } catch (e) {}
          // se vai diminuir (exclusão), guarda uma cópia de segurança
          if (antes > paginas.nodes.length) await m.setItem(PKEY + "_ANTES_EXCLUIR", prev);
        }
        await m.setItem(PKEY, json);
        ok = true;
      }
    } catch (e) {}
    try {
      vendetta.plugin.storage.paginasJson = json;
      ok = true;
    } catch (e) {}
    return ok;
  }

  function savePaginas() {
    paginasSaving = paginasSaving.then(doSavePaginas);
    return paginasSaving;
  }
  function savePaginasSoon() {
    clearTimeout(paginasTimer);
    paginasTimer = setTimeout(function () { paginasTimer = null; savePaginas(); }, 800);
  }
  function flushPaginas() {
    if (paginasTimer) {
      clearTimeout(paginasTimer);
      paginasTimer = null;
      savePaginas();
    }
  }

  function novoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function achar(id) {
    return paginas.nodes.find(function (n) { return n.uid === id; });
  }
  function filhos(pai) {
    return paginas.nodes
      .filter(function (n) { return (n.pai || null) === pai; })
      .sort(function (a, b) {
        if (a.tipo !== b.tipo) return a.tipo === "caminho" ? -1 : 1;
        return (a.criadoEm || 0) - (b.criadoEm || 0);
      });
  }
  function descendentes(id) {
    let r = [];
    filhos(id).forEach(function (f) {
      r.push(f);
      r = r.concat(descendentes(f.uid));
    });
    return r;
  }

  function copiar(texto) {
    try {
      const cb = vendetta.metro.common.clipboard || findByProps("setString");
      cb.setString(texto);
      toast("Copiado!");
      return;
    } catch (e) {}
    try {
      RN.Clipboard.setString(texto);
      toast("Copiado!");
    } catch (e) {
      toast("Não consegui copiar");
    }
  }

  function mkStyles() {
    const sc = (vendetta.ui && vendetta.ui.semanticColors) || {};
    const ss = vendetta.metro.common.stylesheet;
    const mk = (ss && ss.createThemedStyleSheet) || RN.StyleSheet.create;
    const bg = sc.BACKGROUND_PRIMARY || "#1e1f22";
    const bg2 = sc.BACKGROUND_SECONDARY || "#2b2d31";
    const txt = sc.TEXT_NORMAL || "#f2f3f5";
    const mut = sc.TEXT_MUTED || "#949ba4";
    const acc = sc.TEXT_LINK || "#5865f2";
    return mk({
      root: { flex: 1, backgroundColor: bg },
      topo: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: bg2 },
      migalhas: { flexGrow: 1 },
      mig: { color: acc, fontSize: 15 },
      migAtual: { color: txt, fontSize: 15, fontWeight: "bold" },
      sep: { color: mut, fontSize: 15 },
      sair: { color: "#ed4245", fontSize: 15, fontWeight: "bold", marginLeft: 12 },
      secao: { color: mut, fontSize: 12, fontWeight: "bold", marginTop: 16, marginBottom: 6, marginHorizontal: 16 },
      item: { padding: 14, marginHorizontal: 12, marginTop: 8, borderRadius: 8, backgroundColor: bg2 },
      itemTxt: { color: txt, fontSize: 16 },
      sub: { color: mut, fontSize: 13 },
      vazio: { color: mut, textAlign: "center", marginTop: 24, marginBottom: 8 },
      corpo: { padding: 16 },
      texto: { color: txt, fontSize: 16, lineHeight: 24 },
      codigo: { color: txt, backgroundColor: bg2, fontFamily: "monospace", fontSize: 15 },
      input: { color: txt, backgroundColor: bg2, borderRadius: 8, padding: 12, fontSize: 16, minHeight: 160, textAlignVertical: "top" },
      campo: { color: txt, backgroundColor: bg2, borderRadius: 8, padding: 12, fontSize: 16, marginHorizontal: 16, marginTop: 8 },
      amostra: { height: 90, marginHorizontal: 16, marginTop: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
      amostraTxt: { fontSize: 18, fontWeight: "bold" },
      grade: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: 16 },
    });
  }

  // ----- peças de interface nativas do Discord (Forms) -----
  function formsDoDiscord() {
    return (vendetta.ui && vendetta.ui.components && vendetta.ui.components.Forms) || {};
  }
  function icone() {
    for (let i = 0; i < arguments.length; i++) {
      try {
        const id = vendetta.ui.assets.getAssetIDByName(arguments[i]);
        if (id) return id;
      } catch (e) {}
    }
    return undefined;
  }
  function Linha(p, S) {
    const F = formsDoDiscord();
    const Row = F.FormRow;
    if (Row) {
      return h(Row, {
        key: p.key,
        label: p.label,
        subLabel: p.sub,
        leading: p.icone && Row.Icon ? h(Row.Icon, { source: p.icone }) : undefined,
        trailing: p.arrow && Row.Arrow ? h(Row.Arrow, null) : undefined,
        onPress: p.onPress,
      });
    }
    return h(
      RN.TouchableOpacity,
      { key: p.key, style: S.item, onPress: p.onPress },
      h(RN.Text, { style: S.itemTxt }, p.label),
      p.sub ? h(RN.Text, { style: S.sub }, p.sub) : null
    );
  }
  function Secao(key, titulo, filhosEl, S) {
    const F = formsDoDiscord();
    if (F.FormSection) return h(F.FormSection, { key: key, title: titulo }, filhosEl);
    return h(RN.View, { key: key }, h(RN.Text, { style: S.secao }, titulo), filhosEl);
  }

  // ----- telinhas nativas de pergunta e de aceitar/cancelar -----
  function pedirNome(titulo, inicial, botao, cb) {
    vendetta.ui.alerts.showInputAlert({
      title: titulo,
      initialValue: inicial || "",
      placeholder: "Nome",
      confirmText: botao,
      cancelText: "Cancelar",
      onConfirm: function (v) {
        const nome = String(v || "").trim();
        if (!nome) return toast("Escreva um nome");
        cb(nome);
      },
    });
  }
  function confirmar(titulo, texto, botao, fn) {
    vendetta.ui.alerts.showConfirmationAlert({
      title: titulo,
      content: texto,
      confirmText: botao,
      cancelText: "Cancelar",
      confirmColor: "red",
      onConfirm: fn,
    });
  }

  // ----- cores -----
  function hexValido(s) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
  }
  function hsvHex(hh, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return "#" + [r, g, b].map(function (k) {
      return ("0" + Math.round((k + m) * 255).toString(16)).slice(-2);
    }).join("");
  }
  function contraste(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    return lum > 150 ? "#000000" : "#ffffff";
  }
  function corInt(s) {
    if (!s) return 0;
    if (/^#?random$/i.test(s)) return Math.floor(Math.random() * 0xfffffe) + 1;
    let m = String(s).match(/^#?([0-9a-f]{6})$/i);
    if (m) return parseInt(m[1], 16);
    m = String(s).match(/^#([0-9a-f]{3})$/i);
    if (m) return parseInt(m[1].split("").map(function (d) { return d + d; }).join(""), 16);
    return null;
  }

  const PRONTAS = [
    ["Vermelho", "#ed4245"], ["Laranja", "#f57c00"], ["Amarelo", "#fee75c"], ["Verde", "#3ba55d"], ["Azul", "#3498db"],
    ["Roxo", "#9b59b6"], ["Rosa", "#ff69b4"], ["Preto", "#000000"], ["Cinza", "#808080"], ["Branco", "#ffffff"],
  ];

  function CoresTela(props) {
    const S = props.S;
    const [matiz, setMatiz] = React.useState(130);
    const [cor, setCor] = React.useState("#3ba55d");
    const [campo, setCampo] = React.useState("#3BA55D");
    const largura = RN.Dimensions.get("window").width - 32;
    const grade = React.useMemo(function () {
      const cel = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) cel.push(hsvHex(matiz, c / 7, 1 - r * 0.12));
      return cel;
    }, [matiz]);

    function escolher(hex) {
      setCor(hex);
      setCampo(hex.toUpperCase());
    }

    return h(
      RN.ScrollView,
      { style: { flex: 1 } },
      h(RN.View, { style: [S.amostra, { backgroundColor: cor }] }, h(RN.Text, { style: [S.amostraTxt, { color: contraste(cor) }] }, cor.toUpperCase())),
      Secao("matiz", "ESCOLHA O TOM", h(RN.View, { style: S.grade }, Array.apply(null, Array(16)).map(function (_, i) {
        const hh = i * 22.5;
        return h(RN.TouchableOpacity, {
          key: i,
          onPress: function () { setMatiz(hh); },
          style: { width: largura / 16, height: 34, backgroundColor: hsvHex(hh, 1, 1) },
        });
      })), S),
      Secao("tons", "CLARO, ESCURO E FORÇA", h(RN.View, { style: S.grade }, grade.map(function (hex, i) {
        return h(RN.TouchableOpacity, {
          key: i,
          onPress: function () { escolher(hex); },
          style: { width: largura / 8, height: 34, backgroundColor: hex },
        });
      })), S),
      Secao("prontas", "CORES PRONTAS", h(RN.View, { style: S.grade }, PRONTAS.map(function (p) {
        return h(RN.TouchableOpacity, {
          key: p[0],
          onPress: function () { escolher(p[1]); },
          style: { width: 40, height: 40, borderRadius: 20, margin: 4, backgroundColor: p[1], borderWidth: 1, borderColor: "#888888" },
        });
      })), S),
      Secao("codigo", "CÓDIGO (se você já tiver um)", h(RN.TextInput, {
        style: S.campo,
        value: campo,
        autoCapitalize: "characters",
        maxLength: 7,
        onChangeText: function (t) {
          setCampo(t);
          if (/^#[0-9a-fA-F]{6}$/.test(t)) setCor(t.toLowerCase());
        },
      }), S),
      Secao("acoes", "USAR A COR", [
        Linha({ key: "c1", label: "Copiar o código da cor", sub: cor.toUpperCase(), icone: icone("ic_copy", "ic_copy_message_link"), onPress: function () { copiar(cor.toUpperCase()); } }, S),
        Linha({ key: "c2", label: "Copiar como texto colorido", sub: "[texto](" + cor + ")", icone: icone("ic_copy", "ic_copy_message_link"), onPress: function () { copiar("[texto](" + cor + ")"); } }, S),
        Linha({ key: "c3", label: "Cor aleatória", icone: icone("ic_refresh", "ic_sync_24px"), onPress: function () { escolher(hsvHex(Math.random() * 359, 0.5 + Math.random() * 0.5, 0.6 + Math.random() * 0.4)); } }, S),
      ], S),
      h(RN.View, { style: { height: 40 } })
    );
  }

  // Texto da página: `crases` copiam ao tocar e [palavra](#cor) colore
  function renderTexto(txt, S) {
    if (!txt) return h(RN.Text, { style: S.vazio }, "Página vazia. Use Editar texto para escrever.");
    const partes = txt.split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]+\]\(#[0-9a-fA-F]{3,8}\))/);
    return h(
      RN.Text,
      { style: S.texto },
      partes.map(function (p, i) {
        const bloco = p.length > 6 && p.indexOf("```") === 0;
        if (bloco || (p.length > 2 && p.charAt(0) === "`" && p.charAt(p.length - 1) === "`")) {
          const cod = bloco ? p.slice(3, -3).replace(/^\n/, "") : p.slice(1, -1);
          return h(RN.Text, { key: i, style: S.codigo, onPress: function () { copiar(cod); } }, " " + cod + " ");
        }
        const cor = p.match(/^\[([^\]\n]+)\]\((#[0-9a-fA-F]{3,8})\)$/);
        if (cor && hexValido(cor[2])) return h(RN.Text, { key: i, style: { color: cor[2] } }, cor[1]);
        return p;
      })
    );
  }

  // ----- tela principal do Tweet -----
  function TweetApp(props) {
    const S = React.useMemo(mkStyles, []);
    const force = React.useReducer(function (x) { return x + 1; }, 0)[1];
    const [caminho, setCaminho] = React.useState([]);
    const [pagina, setPagina] = React.useState(null);
    const [editando, setEditando] = React.useState(false);
    const [tela, setTela] = React.useState("tweet");
    const [carregado, setCarregado] = React.useState(false);

    React.useEffect(function () {
      paginasReady.then(function () { setCarregado(true); });
      return function () { flushPaginas(); };
    }, []);

    const atual = caminho.length ? caminho[caminho.length - 1] : null;
    const nodeAtual = atual ? achar(atual) : null;
    const nodePagina = pagina ? achar(pagina) : null;

    function irPara(n) {
      setTela("tweet");
      setPagina(null);
      setEditando(false);
      setCaminho(caminho.slice(0, n));
    }
    function voltar() {
      if (tela === "cores") setTela("tweet");
      else if (pagina) { setPagina(null); setEditando(false); }
      else if (caminho.length) setCaminho(caminho.slice(0, -1));
      else props.onClose();
    }
    function sair() {
      flushPaginas();
      props.onClose();
    }

    function adicionar(tipo) {
      pedirNome(tipo === "pagina" ? "Nome da página" : "Nome do caminho", "", "Criar", function (nome) {
        const agora = Date.now();
        const no = { uid: novoId(), pai: atual, tipo: tipo, nome: nome, conteudo: "", criadoEm: agora, editadoEm: agora };
        paginas.nodes.push(no);
        savePaginas();
        if (tipo === "pagina") { setPagina(no.uid); setEditando(true); }
        force();
      });
    }
    function renomear(n) {
      pedirNome("Novo nome", n.nome, "Salvar", function (nome) {
        n.nome = nome;
        n.editadoEm = Date.now();
        savePaginas();
        force();
      });
    }
    function excluir(n) {
      const ids = {};
      [n].concat(descendentes(n.uid)).forEach(function (x) { ids[x.uid] = true; });
      paginas.nodes = paginas.nodes.filter(function (x) { return !ids[x.uid]; });
      if (pagina === n.uid) { setPagina(null); setEditando(false); }
      if (atual === n.uid) setCaminho(caminho.slice(0, -1));
      savePaginas();
      force();
    }
    function pedirExclusao(n) {
      const txt = n.tipo === "caminho"
        ? 'Excluir o caminho "' + n.nome + '" e tudo que está dentro dele (' + descendentes(n.uid).length + " itens)?"
        : 'Excluir a página "' + n.nome + '"?';
      confirmar("Excluir", txt, "Excluir", function () { excluir(n); });
    }

    // trilha: Tweet | Testes | Testes Plugins | 1
    const migas = [{ label: "Tweet", fn: function () { irPara(0); } }];
    caminho.forEach(function (id, i) {
      const n = achar(id);
      migas.push({ label: n ? n.nome : "?", fn: function () { irPara(i + 1); } });
    });
    if (tela === "cores") migas.push({ label: "Cores" });
    else if (nodePagina) migas.push({ label: nodePagina.nome });

    const topo = h(
      RN.View,
      { style: S.topo },
      h(RN.TouchableOpacity, { onPress: voltar }, h(RN.Text, { style: S.mig }, "←  ")),
      h(
        RN.ScrollView,
        { horizontal: true, style: S.migalhas, showsHorizontalScrollIndicator: false },
        migas.map(function (m, i) {
          const ultimo = i === migas.length - 1;
          return h(
            React.Fragment,
            { key: i },
            i > 0 ? h(RN.Text, { style: S.sep }, "  |  ") : null,
            h(RN.TouchableOpacity, { onPress: ultimo ? undefined : m.fn }, h(RN.Text, { style: ultimo ? S.migAtual : S.mig }, m.label))
          );
        })
      ),
      h(RN.TouchableOpacity, { onPress: sair }, h(RN.Text, { style: S.sair }, "Sair"))
    );

    let corpo;
    if (!carregado) {
      corpo = h(RN.Text, { style: S.vazio }, "Carregando...");
    } else if (tela === "cores") {
      corpo = h(CoresTela, { S: S });
    } else if (nodePagina) {
      corpo = h(
        RN.ScrollView,
        { style: { flex: 1 }, keyboardShouldPersistTaps: "handled" },
        Secao("pg", "PÁGINA", [
          Linha({ key: "ed", label: editando ? "Concluir edição" : "Editar texto", icone: icone("ic_edit_24px", "ic_edit"), onPress: function () { setEditando(!editando); flushPaginas(); } }, S),
          editando ? Linha({ key: "cor", label: "Abrir seletor de cores", icone: icone("ic_palette", "ic_theme_24px"), arrow: true, onPress: function () { flushPaginas(); setTela("cores"); } }, S) : null,
          Linha({ key: "rn", label: "Renomear", icone: icone("ic_edit_24px", "ic_edit"), onPress: function () { renomear(nodePagina); } }, S),
          Linha({ key: "ex", label: "Excluir página", icone: icone("ic_trash_24px", "ic_trash"), onPress: function () { pedirExclusao(nodePagina); } }, S),
        ], S),
        h(
          RN.View,
          { style: S.corpo },
          editando
            ? h(RN.TextInput, {
                style: S.input,
                multiline: true,
                defaultValue: nodePagina.conteudo || "",
                placeholder: "Escreva aqui. `crases` copiam ao tocar e [palavra](#cor) colore o texto.",
                placeholderTextColor: "#888888",
                onChangeText: function (t) {
                  nodePagina.conteudo = t;
                  nodePagina.editadoEm = Date.now();
                  savePaginasSoon();
                },
              })
            : renderTexto(nodePagina.conteudo || "", S)
        ),
        h(RN.View, { style: { height: 40 } })
      );
    } else {
      const lista = filhos(atual);
      corpo = h(
        RN.ScrollView,
        { style: { flex: 1 } },
        Secao("add", "ADICIONAR", [
          Linha({ key: "ap", label: "Adicionar página", icone: icone("ic_add_24px", "ic_add"), onPress: function () { adicionar("pagina"); } }, S),
          Linha({ key: "ac", label: "Adicionar caminho", icone: icone("ic_add_24px", "ic_add"), onPress: function () { adicionar("caminho"); } }, S),
        ], S),
        Secao("itens", nodeAtual ? nodeAtual.nome.toUpperCase() : "TWEET", lista.length
          ? lista.map(function (n) {
              return Linha({
                key: n.uid,
                label: n.nome,
                sub: n.tipo === "caminho" ? "Caminho" : "Página",
                icone: n.tipo === "caminho" ? icone("ic_category", "ic_folder") : icone("ic_message_24px", "ic_text_channel"),
                arrow: true,
                onPress: function () { if (n.tipo === "caminho") setCaminho(caminho.concat(n.uid)); else setPagina(n.uid); },
              }, S);
            })
          : h(RN.Text, { key: "v", style: S.vazio }, "Vazio por aqui. Use Adicionar acima."), S),
        nodeAtual
          ? Secao("este", "ESTE CAMINHO", [
              Linha({ key: "r1", label: "Renomear", icone: icone("ic_edit_24px", "ic_edit"), onPress: function () { renomear(nodeAtual); } }, S),
              Linha({ key: "r2", label: "Excluir caminho", icone: icone("ic_trash_24px", "ic_trash"), onPress: function () { pedirExclusao(nodeAtual); } }, S),
            ], S)
          : Secao("tools", "FERRAMENTAS", [
              Linha({ key: "t1", label: "Seletor de cores", sub: "Escolha uma cor e copie o código", icone: icone("ic_palette", "ic_theme_24px"), arrow: true, onPress: function () { setTela("cores"); } }, S),
            ], S),
        h(RN.View, { style: { height: 40 } })
      );
    }

    return h(RN.View, { style: S.root }, topo, corpo);
  }

  // Se algo der errado na tela, mostra o erro em vez de travar o app
  class Barreira extends React.Component {
    constructor(p) {
      super(p);
      this.state = { erro: null };
    }
    static getDerivedStateFromError(e) {
      return { erro: e };
    }
    render() {
      if (this.state.erro) {
        return h(RN.Text, { style: { color: "#ed4245", padding: 16 } }, "Erro no Tweet: " + (this.state.erro.message || this.state.erro));
      }
      return this.props.children;
    }
  }

  // Abertura 1: botão "Tweet" na tela do plugin (Configurações > Plugins > Alphacord > engrenagem)
  function TweetConfig() {
    const S = React.useMemo(mkStyles, []);
    const [aberto, setAberto] = React.useState(false);
    if (aberto) {
      return h(RN.View, { style: { flex: 1 } }, h(Barreira, null, h(TweetApp, { onClose: function () { setAberto(false); } })));
    }
    return h(
      RN.ScrollView,
      { style: S.root },
      Secao("alpha", "ALPHACORD", [
        Linha({ key: "tweet", label: "Tweet", sub: "Suas anotações privadas e ferramentas", icone: icone("ic_message_24px", "ic_text_channel"), arrow: true, onPress: function () { setAberto(true); } }, S),
      ], S)
    );
  }

  // Abertura 2: .tweet ou /tweet (janela por cima do chat)
  function fecharTweet() {
    flushPaginas();
    try { findByProps("openAlert", "dismissAlert").dismissAlert(ALERT_KEY); } catch (e) {}
  }
  function abrirTweet(ctx) {
    try {
      const win = RN.Dimensions.get("window");
      findByProps("openAlert", "dismissAlert").openAlert(
        ALERT_KEY,
        h(
          RN.View,
          { style: { width: win.width, height: win.height * 0.85, overflow: "hidden", borderRadius: 12 } },
          h(Barreira, null, h(TweetApp, { onClose: fecharTweet }))
        )
      );
      return;
    } catch (e) {}
    out(ctx, "Não consegui abrir o Tweet por aqui. Abra em Configurações > Plugins > Alphacord (engrenagem).");
  }

  // ===== Comandos de servidor: .criar / .deletar / .wiki =====
  const TIPOS = { texto: 0, voz: 2, topicos: 15, "tópicos": 15, topico: 15, "tópico": 15, forum: 15, "fórum": 15 };
  const recentes = {};
  let fila = Promise.resolve();

  function naFila(fn) {
    fila = fila.then(fn).catch(function () {});
    return fila;
  }
  function chave(s) {
    return String(s).trim().toLowerCase();
  }
  function tokens(s) {
    const res = [];
    const re = /"([^"]*)"|“([^”]*)”|(\S+)/g;
    let m;
    while ((m = re.exec(s || ""))) {
      const q = m[1] !== undefined || m[2] !== undefined;
      res.push({ q: q, v: m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] });
    }
    return res;
  }
  function rest() {
    return findByProps("getAPIBaseURL", "get");
  }
  function erroTxt(e) {
    const msg = (e && e.body && e.body.message) || (e && e.message) || String(e);
    return e && e.status === 403 ? msg + " (sem permissão)" : msg;
  }
  function guildDe(ctx) {
    try {
      const ch = vendetta.metro.findByStoreName("ChannelStore").getChannel(ctx.channelId);
      return ch && ch.guild_id ? ch.guild_id : null;
    } catch (e) {
      return null;
    }
  }
  function canaisDe(gid) {
    try { return Object.values(vendetta.metro.findByStoreName("ChannelStore").getMutableGuildChannelsForGuild(gid)); } catch (e) { return []; }
  }
  function cargosDe(gid) {
    try { return Object.values(vendetta.metro.findByStoreName("GuildStore").getRoles(gid)); } catch (e) { return []; }
  }
  function esquecer(id) {
    Object.keys(recentes).forEach(function (k) { if (recentes[k] === id) delete recentes[k]; });
  }
  function acharCanal(gid, nome, tipos) {
    const k = chave(nome);
    const kh = k.replace(/\s+/g, "-");
    for (let i = 0; i < tipos.length; i++) {
      const id = recentes[gid + "|" + tipos[i] + "|" + k] || recentes[gid + "|" + tipos[i] + "|" + kh];
      if (id) return [{ id: id, name: nome }];
    }
    return canaisDe(gid).filter(function (c) {
      return tipos.indexOf(c.type) >= 0 && (chave(c.name) === k || chave(c.name) === kh);
    });
  }
  function acharCargo(gid, nome) {
    const k = chave(nome);
    const cache = recentes[gid + "|r|" + k];
    if (cache) return [{ id: cache, name: nome }];
    return cargosDe(gid).filter(function (r) { return r.id !== gid && chave(r.name) === k; });
  }

  // ---- criar ----
  function parseCanal(raw) {
    const t = tokens(raw);
    if (!t.length) return null;
    const res = { nome: t.shift().v, tipo: 0, cat: null };
    while (t.length) {
      const k = t[0].v.toLowerCase();
      if (!t[0].q && TIPOS[k] !== undefined) { res.tipo = TIPOS[k]; t.shift(); continue; }
      if (!t[0].q && k === "em") {
        t.shift();
        res.cat = t.map(function (x) { return x.v; }).join(" ").trim();
        break;
      }
      return { erro: 'Não entendi "' + t[0].v + '". Veja `.wiki "criar canal"`.' };
    }
    return res;
  }

  async function doCriarCanal(ctx, raw) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const a = parseCanal(raw);
    if (!a || a.erro) return out(ctx, (a && a.erro) || 'Use: `.criar canal "nome" texto em Categoria` (veja `.wiki "criar canal"`).');
    let pai = null;
    if (a.cat) {
      const achados = acharCanal(gid, a.cat, [4]);
      if (!achados.length) return out(ctx, 'Não achei a categoria "' + a.cat + '". Crie antes com `.criar categoria ' + a.cat + "`.");
      pai = achados[0].id;
    }
    try {
      const body = { name: a.nome, type: a.tipo };
      if (pai) body.parent_id = pai;
      const r = await rest().post({ url: "/guilds/" + gid + "/channels", body: body });
      const c = r.body;
      recentes[gid + "|" + a.tipo + "|" + chave(c.name || a.nome)] = c.id;
      out(ctx, "✅ Canal criado: " + (a.tipo === 0 ? "#" : "") + (c.name || a.nome));
    } catch (e) {
      out(ctx, "❌ Não consegui criar o canal: " + erroTxt(e));
    }
  }

  async function doCriarCategoria(ctx, raw) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const nome = tokens(raw).map(function (t) { return t.v; }).join(" ").trim();
    if (!nome) return out(ctx, "Use: `.criar categoria Nome`.");
    try {
      const r = await rest().post({ url: "/guilds/" + gid + "/channels", body: { name: nome, type: 4 } });
      recentes[gid + "|4|" + chave(r.body.name || nome)] = r.body.id;
      out(ctx, "✅ Categoria criada: " + (r.body.name || nome));
    } catch (e) {
      out(ctx, "❌ Não consegui criar a categoria: " + erroTxt(e));
    }
  }

  // permissões dos cargos (números de bit das permissões do Discord)
  function mascara(bits) {
    let r = BigInt(0);
    bits.forEach(function (b) { r = r | (BigInt(1) << BigInt(b)); });
    return r.toString();
  }
  function permissoesDoCargo(num) {
    const membro = [0, 6, 9, 10, 11, 14, 15, 16, 18, 20, 21, 25, 26, 31, 32, 35, 37, 38, 39, 42, 45, 46, 49, 50];
    const todas = [];
    for (let i = 0; i <= 50; i++) todas.push(i);
    if (num === 1) return "0";
    if (num === 2) return mascara(membro);
    if (num === 3) return mascara(membro.concat([8, 36, 43, 44]));
    if (num === 4) return mascara(membro.concat([1, 7, 8, 13, 22, 23, 24, 27, 33, 34, 36, 40]));
    if (num === 5) return mascara(todas.filter(function (b) { return b !== 3 && b !== 47; }));
    return mascara(todas);
  }

  function parseCargo(linha) {
    const t = tokens(linha);
    if (t.length < 2) return { erro: 'Faltou o número em: ' + linha };
    const num = parseInt(t[1].v, 10);
    if (!(num >= 1 && num <= 6)) return { erro: "Número inválido (use de 1 a 6) em: " + linha };
    let cor = 0;
    if (t[2]) {
      cor = corInt(t[2].v);
      if (cor === null) return { erro: "Cor inválida em: " + linha };
    }
    return { nome: t[0].v, num: num, cor: cor };
  }

  async function criarUmCargo(gid, c) {
    const r = await rest().post({ url: "/guilds/" + gid + "/roles", body: { name: c.nome, permissions: permissoesDoCargo(c.num), color: c.cor } });
    recentes[gid + "|r|" + chave(c.nome)] = r.body.id;
    return r.body;
  }

  async function doCriarCargos(ctx, raw) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const linhas = String(raw || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!linhas.length) return out(ctx, 'Use: `.criar cargo "Nome" 2 #random` (veja `.wiki "criar cargo"`).');
    const itens = [];
    const erros = [];
    linhas.forEach(function (l) {
      const c = parseCargo(l);
      if (c.erro) erros.push(c.erro);
      else itens.push(c);
    });
    if (erros.length) return out(ctx, "❌ Nada foi criado. Corrija:\n" + erros.join("\n"));
    let feitos = 0;
    const falhas = [];
    for (let i = 0; i < itens.length; i++) {
      try {
        await criarUmCargo(gid, itens[i]);
        feitos++;
      } catch (e) {
        falhas.push(itens[i].nome + ": " + erroTxt(e));
      }
      if (i < itens.length - 1) await new Promise(function (res) { setTimeout(res, 500); });
    }
    out(ctx, (feitos ? "✅ Cargos criados: " + feitos : "❌ Nenhum cargo criado.") + (falhas.length ? "\n❌ Falharam:\n" + falhas.join("\n") : ""));
  }

  // ---- deletar (sempre com a telinha de aceitar/cancelar) ----
  async function doDeletarCanal(ctx, raw, tipos, rotulo) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const nome = tokens(raw).map(function (t) { return t.v; }).join(" ").trim();
    if (!nome) return out(ctx, 'Diga o nome. Veja `.wiki "deletar ' + rotulo + '"`.');
    const achados = acharCanal(gid, nome, tipos);
    if (!achados.length) return out(ctx, "Não achei " + rotulo + ' com o nome "' + nome + '".');
    if (achados.length > 1) return out(ctx, "Achei " + achados.length + " itens com esse nome. Renomeie um deles e tente de novo.");
    const alvo = achados[0];
    confirmar(
      "Deletar " + rotulo,
      'Deletar "' + nome + '"?' + (rotulo === "categoria" ? " Os canais dentro dela NÃO são apagados." : " Isso apaga o canal e as mensagens dele. Não dá para desfazer."),
      "Deletar",
      async function () {
        try {
          await rest().del({ url: "/channels/" + alvo.id });
          esquecer(alvo.id);
          out(ctx, "🗑️ Deletado: " + nome);
        } catch (e) {
          out(ctx, "❌ Não consegui deletar: " + erroTxt(e));
        }
      }
    );
  }

  async function doDeletarCargo(ctx, raw) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const nome = tokens(raw).map(function (t) { return t.v; }).join(" ").trim();
    if (!nome) return out(ctx, 'Diga o nome. Veja `.wiki "deletar cargo"`.');
    const achados = acharCargo(gid, nome);
    if (!achados.length) return out(ctx, 'Não achei um cargo chamado "' + nome + '".');
    if (achados.length > 1) return out(ctx, "Achei " + achados.length + " cargos com esse nome. Renomeie um deles e tente de novo.");
    const alvo = achados[0];
    confirmar("Deletar cargo", 'Deletar o cargo "' + nome + '"? Quem tem esse cargo perde ele.', "Deletar", async function () {
      try {
        await rest().del({ url: "/guilds/" + gid + "/roles/" + alvo.id });
        esquecer(alvo.id);
        out(ctx, "🗑️ Cargo deletado: " + nome);
      } catch (e) {
        out(ctx, "❌ Não consegui deletar o cargo: " + erroTxt(e));
      }
    });
  }

  // ---- textos do .wiki ----
  function wikiCanal() {
    return [
      "**.criar canal**",
      "Para criar um canal, é simples, apenas use:",
      "",
      '`.criar canal` "nome-do-canal" {||tipo: texto, voz ou tópicos||} em {||categoria, deixe em branco para não colocar em nenhuma categoria||}',
      "",
      "Exemplos:",
      '`.criar canal "chat-geral" texto em Comunidade`',
      '`.criar canal "call-geral" voz em Comunidade`',
      '`.criar canal "avisos"`',
    ].join("\n");
  }
  function wikiCargo() {
    return [
      "**.criar cargo**",
      "Para criar cargo, ou cargos, é simples, apenas use:",
      "",
      '`.criar cargo` "Nome do cargo" {número}',
      "",
      "Aviso: coloque um código de cor no final, se quiser vir direto com cor. Use #random para gerar uma cor aleatória.",
      "",
      "Números:",
      "1- Cosmético: não tem permissão nenhuma, serve só de enfeite",
      "2- Membro: tem as permissões normais de um membro",
      "3- Verificado: as de um membro, com algumas a mais",
      "4- Staff: as permissões básicas de um staff (você ainda precisa configurar)",
      "5- noadm: todas as permissões, menos Administrador. Útil para dar poder a alguém em quem você não confia 100%",
      "6- Administrador: todas as permissões",
      "",
      "Para criar vários cargos de uma vez, use `.criar cargos` dentro de um bloco de código (veja `.wiki \"criar cargos\"`).",
    ].join("\n");
  }
  function wikiCargos() {
    return [
      "**.criar cargos**",
      "Extremamente simples, você precisa usar um bloco de código:",
      "",
      "```",
      ".criar cargos",
      '"Membro" 2 #random',
      '"Guarda costas" 4 #random',
      '"adm" 6 #random',
      '"Hétero" 1 #random',
      '"LGBT+" 1 #random',
      '"Não Binário" 1 #random',
      '"+18" 1 #random',
      '"-18" 1 #random',
      "```",
      "",
      'Cada linha é: "Nome" número cor. A cor é opcional.',
    ].join("\n");
  }

  function cmdServidor(aliases, desc, usage, wiki, fn) {
    return {
      name: aliases[0],
      aliases: aliases,
      desc: desc,
      usage: usage,
      wiki: wiki,
      raw: true,
      local: true,
      noSlash: true,
      run: function (ctx, a) {
        return naFila(function () { return fn(ctx, (a && a.raw) || ""); });
      },
    };
  }

  // ---- reconhecimento dos comandos com ponto (aceita comandos de duas palavras e bloco de código) ----
  function matchPrefix(text) {
    let t = text.trim();
    const fence = t.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
    if (fence) t = fence[1].trim();
    if (t.charAt(0) !== ".") return null;
    const body = t.slice(1);
    let best = null;
    CMDS.forEach(function (c) {
      c.aliases.forEach(function (al) {
        const re = new RegExp("^" + al.replace(/\s+/g, "\\s+") + "(?=\\s|$)", "i");
        if (re.test(body) && (!best || al.length > best.len)) best = { cmd: c, len: al.length, re: re };
      });
    });
    if (!best) return null;
    return { cmd: best.cmd, rest: body.replace(best.re, "").trim() };
  }

  // ===== Ciclo de vida do plugin =====
  const life = {
    onLoad: function () {
      ready = loadDb().catch(function () {});
      paginasReady = loadPaginas().catch(function () {});

      CMDS.forEach(function (c) {
        if (c.noSlash) return;
        unregs.push(
          vendetta.commands.registerCommand({
            name: c.name,
            displayName: c.name,
            description: c.desc,
            displayDescription: c.desc,
            options: (c.options || []).map(function (o) {
              return {
                name: o.name,
                displayName: o.name,
                description: o.desc,
                displayDescription: o.desc,
                type: 3,
                required: !!o.required,
              };
            }),
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: function (args, ctx) {
              const a = {};
              (args || []).forEach(function (x) { a[x.name] = x.value; });
              run(c, { channelId: ctx.channel.id, viaPrefix: false }, a);
            },
          })
        );
      });

      if (MA) unpatchSend = patcher.instead("sendMessage", MA, onSend);
      toast("Alphacord carregado!");
    },
    onUnload: function () {
      unregs.splice(0).forEach(function (u) {
        try { u(); } catch (e) {}
      });
      if (unpatchSend) unpatchSend();
      unpatchSend = null;
      pending = null;
      flushPaginas();
      // os dados salvos NÃO são apagados ao descarregar
    },
    settings: TweetConfig,
  };

  return Object.assign({ default: life }, life);
})()
