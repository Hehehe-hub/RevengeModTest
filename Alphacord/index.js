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
      if (modoConta && MA) sendReal(c.channelId, p);
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
      name: "trocar",
      aliases: ["trocar"],
      desc: "Troca quem responde: sua conta ou o bot",
      usage: "(opcional: conta ou bot)",
      raw: true,
      local: true,
      options: [{ name: "modo", desc: "conta ou bot (vazio = alterna)", required: false }],
      run: function (ctx, args) {
        return trocarModo(ctx, String(args.raw || args.modo || ""));
      },
    },
    cmdServidor(["criar tudo", "montar"], "Monta cargos, categorias e canais de uma vez (JSON)", "(JSON em bloco de código)", wikiTudo(), doCriarTudo),
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
      