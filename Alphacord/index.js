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

  // Todas as respostas do plugin são locais.
  // O plugin não chama sendMessage para enviar como a conta do usuário.
  function out(c, text) {
    chunk(text).forEach(function (p) {
      botMsg(c.channelId, p);
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
    cmdServidor(
      ["deletar cargos"], "Deleta vários cargos por nome (com confirmação)", "um nome por linha",
      '**.deletar cargos**\nEnvie um nome de cargo por linha. A lista inteira aparece para confirmação antes de apagar.',
      function (ctx, raw) { return doDeletarEmMassa(ctx, raw, "cargo"); }
    ),
    cmdServidor(
      ["deletar canais"], "Deleta vários canais por nome (com confirmação)", "um nome por linha",
      '**.deletar canais**\nEnvie um nome de canal por linha. A lista inteira aparece para confirmação antes de apagar.',
      function (ctx, raw) { return doDeletarEmMassa(ctx, raw, "canal"); }
    ),
    cmdServidor(
      ["deletar categorias"], "Deleta várias categorias por nome (com confirmação)", "uma categoria por linha",
      '**.deletar categorias**\nEnvie uma categoria por linha. Os canais dentro delas não são apagados.',
      function (ctx, raw) { return doDeletarEmMassa(ctx, raw, "categoria"); }
    ),
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
      if (internal) return orig.apply(MA, args);
      const channelId = args[0];
      const msg = args[1];
      const text = msg && typeof msg.content === "string" ? msg.content.trim() : "";
      if (!text) return orig.apply(MA, args);

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
        return ESCONDER_RESPOSTAS ? Promise.resolve() : orig.apply(MA, args);
      }
    } catch (e) {}
    return orig.apply(MA, args);
  }

  // ===== Comandos de servidor: .criar / .deletar / .wiki =====
  const TIPOS = { texto: 0, voz: 2, topicos: 15, "tópicos": 15, topico: 15, "tópico": 15, forum: 15, "fórum": 15 };
  const recentes = {};
  let fila = Promise.resolve();

  function naFila(fn) {
    fila = fila.then(fn).catch(function (e) {
      toast("Erro na operação: " + erroTxt(e));
    });
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
  function limparBloco(raw) {
    let texto = String(raw || "").trim();
    const bloco = texto.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/);
    if (bloco) texto = bloco[1].trim();
    return texto;
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
    const repetido = canaisDe(gid).some(function (c) {
      return c.type === a.tipo && chave(c.name) === chave(a.nome) && (c.parent_id || null) === pai;
    });
    if (repetido) return out(ctx, 'Já existe um canal chamado "' + a.nome + '" nesse local.');
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
    if (acharCanal(gid, nome, [4]).length) return out(ctx, 'Já existe uma categoria chamada "' + nome + '".');
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
    let r = 0;
    bits.forEach(function (b) { r += Math.pow(2, b); });
    return String(r);
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
    const linhas = limparBloco(raw).split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!linhas.length) return out(ctx, 'Use: `.criar cargo "Nome" 2 #random` (veja `.wiki "criar cargo"`).');
    if (linhas.length > 100) return out(ctx, "Limite de 100 cargos por operação.");

    const itens = [];
    const erros = [];
    const vistos = {};
    linhas.forEach(function (l) {
      const c = parseCargo(l);
      if (c.erro) { erros.push(c.erro); return; }
      const k = chave(c.nome);
      if (vistos[k]) { erros.push('Nome repetido na lista: "' + c.nome + '"'); return; }
      vistos[k] = true;
      if (!acharCargo(gid, c.nome).length) itens.push(c);
    });
    if (erros.length) return out(ctx, "❌ Nada foi criado. Corrija:\n" + erros.join("\n"));
    const pulados = linhas.length - itens.length;
    if (!itens.length) return out(ctx, "Todos os cargos da lista já existem. Nada foi criado.");

    async function executarAgora() {
      let feitos = 0;
      const falhas = [];
      for (let i = 0; i < itens.length; i++) {
        try {
          await criarUmCargo(gid, itens[i]);
          feitos++;
        } catch (e) {
          falhas.push(itens[i].nome + ": " + erroTxt(e));
        }
        if (i < itens.length - 1) await esperar(650);
      }
      out(ctx, (feitos ? "✅ Cargos criados: " + feitos : "❌ Nenhum cargo criado.") +
        (pulados ? "\nJá existiam: " + pulados : "") +
        (falhas.length ? "\n❌ Falharam:\n" + falhas.slice(0, 12).join("\n") : ""));
    }

    // O comando já está dentro da fila. Não enfileire novamente aqui para evitar deadlock.
    if (itens.length === 1) return executarAgora();
    confirmarCriar(
      "Criar vários cargos",
      "Serão criados " + itens.length + " cargos." + (pulados ? "\nJá existentes serão pulados: " + pulados : "") + "\nContinuar?",
      function () { naFila(executarAgora); }
    );
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

  async function doDeletarEmMassa(ctx, raw, tipo) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    const nomes = limparBloco(raw).split("\n").map(function (x) {
      return tokens(x).map(function (t) { return t.v; }).join(" ").trim();
    }).filter(Boolean);
    if (!nomes.length) return out(ctx, "Envie um nome por linha. Exemplo:\n```\nNome 1\nNome 2\n```");
    if (nomes.length > 100) return out(ctx, "Limite de 100 itens por operação.");

    const tipos = tipo === "categoria" ? [4] : [0, 2, 5, 13, 15];
    const alvos = [];
    const problemas = [];
    const vistos = {};
    nomes.forEach(function (nome) {
      const chaveNome = chave(nome);
      if (vistos[chaveNome]) return;
      vistos[chaveNome] = true;
      const encontrados = tipo === "cargo" ? acharCargo(gid, nome) : acharCanal(gid, nome, tipo === "categoria" ? [4] : tipos);
      if (!encontrados.length) problemas.push('Não encontrado: "' + nome + '"');
      else if (encontrados.length > 1) problemas.push('Nome ambíguo: "' + nome + '" (' + encontrados.length + ' resultados)');
      else alvos.push({ id: encontrados[0].id, nome: nome });
    });
    if (!alvos.length) return out(ctx, "Nenhum item válido para apagar." + (problemas.length ? "\n" + problemas.join("\n") : ""));

    const aviso = tipo === "categoria"
      ? "\nOs canais dentro das categorias permanecerão no servidor."
      : tipo === "canal"
        ? "\nA exclusão dos canais também remove o histórico deles."
        : "\nMembros perderão os cargos removidos.";
    confirmar(
      "Deletar " + alvos.length + (tipo === "cargo" ? " cargos" : tipo === "categoria" ? " categorias" : " canais"),
      alvos.map(function (x) { return "• " + x.nome; }).join("\n") + aviso +
        (problemas.length ? "\n\nItens ignorados:\n" + problemas.slice(0, 8).join("\n") : "") + "\n\nTem certeza?",
      "Deletar",
      function () {
        naFila(async function () {
          let removidos = 0;
          const falhas = [];
          for (let i = 0; i < alvos.length; i++) {
            const alvo = alvos[i];
            try {
              const url = tipo === "cargo"
                ? "/guilds/" + gid + "/roles/" + alvo.id
                : "/channels/" + alvo.id;
              await rest().del({ url: url });
              esquecer(alvo.id);
              removidos++;
            } catch (e) {
              falhas.push(alvo.nome + ": " + erroTxt(e));
            }
            if (i < alvos.length - 1) await esperar(650);
          }
          out(ctx, "🗑️ Removidos: " + removidos + "/" + alvos.length +
            (problemas.length ? "\nIgnorados: " + problemas.length : "") +
            (falhas.length ? "\nFalhas:\n" + falhas.slice(0, 10).join("\n") : ""));
        });
      }
    );
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

  // ---- .criar tudo: monta cargos, categorias e canais a partir de um JSON ----
  function esperar(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }
  function listaNomes(v) {
    return Array.isArray(v) ? v.map(String) : [];
  }
  function confirmarCriar(titulo, texto, fn) {
    vendetta.ui.alerts.showConfirmationAlert({
      title: titulo,
      content: texto,
      confirmText: "Criar",
      cancelText: "Cancelar",
      confirmColor: "brand",
      onConfirm: fn,
    });
  }

  function normCanal(c, ref, erros) {
    const o = typeof c === "string" ? { nome: c } : Array.isArray(c) ? { nome: c[0], tipo: c[1] } : c || {};
    if (!o.nome) { erros.push(ref + ": falta o nome do canal"); return null; }
    const tipo = o.tipo === undefined || o.tipo === null ? 0 : TIPOS[chave(o.tipo)];
    if (tipo === undefined) { erros.push(ref + ' ("' + o.nome + '"): tipo inválido (use texto, voz ou topicos)'); return null; }
    if (o.privado_para !== undefined && !Array.isArray(o.privado_para)) {
      erros.push(ref + ': "privado_para" precisa ser uma lista [ ]');
      return null;
    }
    if (o.escrevem !== undefined && !Array.isArray(o.escrevem)) {
      erros.push(ref + ': "escrevem" precisa ser uma lista [ ]');
      return null;
    }
    return {
      nome: String(o.nome),
      tipo: tipo,
      topico: o.topico ? String(o.topico) : null,
      ro: !!o.somente_leitura,
      priv: o.privado_para ? listaNomes(o.privado_para) : null,
      escrevem: listaNomes(o.escrevem),
    };
  }

  function montarPlano(dados, gid) {
    const erros = [];
    const plano = { cargos: [], cats: [], soltos: [], erros: erros, total: 0 };
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
      erros.push('O JSON precisa começar com { e ter "cargos", "categorias" e/ou "canais".');
      return plano;
    }
    ["cargos", "categorias", "canais"].forEach(function (campo) {
      if (dados[campo] !== undefined && !Array.isArray(dados[campo])) {
        erros.push('O campo "' + campo + '" precisa ser uma lista [ ].');
      }
    });
    if (erros.length) return plano;
    (dados.cargos || []).forEach(function (c, i) {
      const o = Array.isArray(c) ? { nome: c[0], numero: c[1], cor: c[2] } : c || {};
      const ref = "cargo " + (i + 1) + (o.nome ? ' ("' + o.nome + '")' : "");
      if (!o.nome) return erros.push(ref + ": falta o nome");
      const num = parseInt(o.numero, 10);
      if (!(num >= 1 && num <= 6)) return erros.push(ref + ": o número precisa ser de 1 a 6");
      const cor = o.cor === undefined || o.cor === null ? 0 : corInt(String(o.cor));
      if (cor === null) return erros.push(ref + ": cor inválida");
      plano.cargos.push({ nome: String(o.nome), num: num, cor: cor, separar: !!o.separar });
    });
    (dados.categorias || []).forEach(function (cat, i) {
      const ref = "categoria " + (i + 1);
      if (!cat || typeof cat !== "object" || Array.isArray(cat) || !cat.nome) {
        erros.push(ref + ": informe um objeto com o campo nome");
        return;
      }
      if (cat.canais !== undefined && !Array.isArray(cat.canais)) {
        erros.push(ref + ': o campo "canais" precisa ser uma lista [ ]');
        return;
      }
      if (cat.privado_para !== undefined && !Array.isArray(cat.privado_para)) {
        erros.push(ref + ': o campo "privado_para" precisa ser uma lista [ ]');
        return;
      }
      const c = { nome: String(cat.nome), priv: listaNomes(cat.privado_para), canais: [] };
      (cat.canais || []).forEach(function (x, j) {
        const k = normCanal(x, ref + ' ("' + c.nome + '") canal ' + (j + 1), erros);
        if (k) c.canais.push(k);
      });
      plano.cats.push(c);
    });
    (dados.canais || []).forEach(function (x, j) {
      const k = normCanal(x, "canal solto " + (j + 1), erros);
      if (k) plano.soltos.push(k);
    });

    // todo cargo citado precisa existir no JSON ou no servidor
    const doJson = {};
    plano.cargos.forEach(function (c) { doJson[chave(c.nome)] = true; });
    function confere(lista, onde) {
      (lista || []).forEach(function (n) {
        if (!doJson[chave(n)] && !acharCargo(gid, n).length) erros.push(onde + ': o cargo "' + n + '" não existe (crie em "cargos" ou no servidor)');
      });
    }
    plano.cats.forEach(function (c) {
      confere(c.priv, 'categoria "' + c.nome + '"');
      c.canais.forEach(function (k) { confere(k.priv, 'canal "' + k.nome + '"'); confere(k.escrevem, 'canal "' + k.nome + '"'); });
    });
    plano.soltos.forEach(function (k) { confere(k.priv, 'canal "' + k.nome + '"'); confere(k.escrevem, 'canal "' + k.nome + '"'); });

    let canais = plano.soltos.length;
    plano.cats.forEach(function (c) { canais += c.canais.length; });
    plano.nCanais = canais;
    plano.total = plano.cargos.length + plano.cats.length + canais;
    if (plano.total > 150) erros.push("Muita coisa de uma vez (" + plano.total + "). O limite é 150 itens por comando.");
    return plano;
  }

  // permissões de visualização/escrita por cargo (1024 = ver canal, 2048 = enviar mensagens)
  function overwritesDe(gid, priv, ro, escrevem, idDe) {
    const map = {};
    const faltando = [];
    function add(id, allow, deny) {
      const o = map[id] || (map[id] = { id: id, allow: 0, deny: 0 });
      o.allow = o.allow | allow;
      o.deny = o.deny | deny;
    }
    function resolver(nome, allow) {
      const id = idDe(nome);
      if (!id) faltando.push(nome);
      else add(id, allow, 0);
    }
    if (priv && priv.length) {
      add(gid, 0, 1024);
      priv.forEach(function (n) { resolver(n, 1024); });
    }
    if (ro) add(gid, 0, 2048);
    (escrevem || []).forEach(function (n) { resolver(n, 2048); });
    const lista = Object.keys(map).map(function (k) {
      return { id: map[k].id, type: 0, allow: String(map[k].allow), deny: String(map[k].deny) };
    });
    return { lista: lista, faltando: faltando };
  }

  async function executarPlano(ctx, gid, plano) {
    const r = { cargos: 0, cats: 0, canais: 0, existiam: 0 };
    const falhas = [];
    const ids = {};
    let parar = false;

    function idCargo(n) {
      return ids[chave(n)] || (acharCargo(gid, n)[0] || {}).id;
    }
    async function passo(rotulo, fn) {
      if (parar) return false;
      try {
        await fn();
        await esperar(600);
        return true;
      } catch (e) {
        falhas.push(rotulo + ": " + erroTxt(e));
        if (e && e.status === 403) parar = true;
        return false;
      }
    }
    async function criarCanalDoPlano(k, catId, privCat) {
      const kk = chave(k.nome);
      const kh = kk.replace(/\s+/g, "-");
      const existe = canaisDe(gid).some(function (c) {
        return c.type === k.tipo && (chave(c.name) === kk || chave(c.name) === kh) && (c.parent_id || null) === catId;
      });
      if (existe) { r.existiam++; return; }
      const o = overwritesDe(gid, k.priv || privCat, k.ro, k.escrevem, idCargo);
      if (o.faltando.length) { falhas.push('canal "' + k.nome + '": faltou o cargo ' + o.faltando.join(", ")); return; }
      await passo('canal "' + k.nome + '"', async function () {
        const body = { name: k.nome, type: k.tipo };
        if (catId) body.parent_id = catId;
        if (k.topico && k.tipo !== 2) body.topic = k.topico;
        if (o.lista.length) body.permission_overwrites = o.lista;
        const res = await rest().post({ url: "/guilds/" + gid + "/channels", body: body });
        recentes[gid + "|" + k.tipo + "|" + chave(res.body.name || k.nome)] = res.body.id;
        r.canais++;
      });
    }

    for (let i = 0; i < plano.cargos.length; i++) {
      const c = plano.cargos[i];
      const ja = acharCargo(gid, c.nome);
      if (ja.length) { ids[chave(c.nome)] = ja[0].id; r.existiam++; continue; }
      await passo('cargo "' + c.nome + '"', async function () {
        const res = await rest().post({
          url: "/guilds/" + gid + "/roles",
          body: { name: c.nome, permissions: permissoesDoCargo(c.num), color: c.cor, hoist: c.separar },
        });
        ids[chave(c.nome)] = res.body.id;
        recentes[gid + "|r|" + chave(c.nome)] = res.body.id;
        r.cargos++;
      });
    }

    for (let i = 0; i < plano.cats.length; i++) {
      const cat = plano.cats[i];
      let catId = null;
      const ja = acharCanal(gid, cat.nome, [4]);
      if (ja.length) {
        catId = ja[0].id;
        r.existiam++;
      } else {
        const o = overwritesDe(gid, cat.priv, false, [], idCargo);
        if (o.faltando.length) { falhas.push('categoria "' + cat.nome + '": faltou o cargo ' + o.faltando.join(", ")); continue; }
        const ok = await passo('categoria "' + cat.nome + '"', async function () {
          const body = { name: cat.nome, type: 4 };
          if (o.lista.length) body.permission_overwrites = o.lista;
          const res = await rest().post({ url: "/guilds/" + gid + "/channels", body: body });
          catId = res.body.id;
          recentes[gid + "|4|" + chave(res.body.name || cat.nome)] = catId;
          r.cats++;
        });
        if (!ok) continue;
      }
      for (let j = 0; j < cat.canais.length; j++) await criarCanalDoPlano(cat.canais[j], catId, cat.priv);
    }
    for (let j = 0; j < plano.soltos.length; j++) await criarCanalDoPlano(plano.soltos[j], null, null);

    out(
      ctx,
      (parar ? "⚠️ Parei no meio: você não tem permissão para isso neste servidor." : falhas.length ? "⚠️ Terminei com problemas." : "✅ Pronto!") +
        "\nCargos: " + r.cargos + " | Categorias: " + r.cats + " | Canais: " + r.canais +
        (r.existiam ? " | Já existiam: " + r.existiam : "") +
        (falhas.length ? "\n❌ Problemas:\n" + falhas.slice(0, 8).join("\n") : "")
    );
  }

  async function doCriarTudo(ctx, raw) {
    const gid = guildDe(ctx);
    if (!gid) return out(ctx, "Use isso dentro de um servidor.");
    let txt = limparBloco(raw);
    txt = txt.replace(/[“”]/g, '"');
    if (!txt) return out(ctx, 'Cole o JSON depois do comando, dentro de um bloco de código. Veja `.wiki "criar tudo"`.');
    let dados;
    try {
      dados = JSON.parse(txt);
    } catch (e) {
      return out(ctx, "❌ O JSON tem um erro: " + e.message + '\nConfira vírgulas, aspas e chaves. Veja `.wiki "criar tudo"`.');
    }
    const plano = montarPlano(dados, gid);
    if (plano.erros.length) return out(ctx, "❌ Nada foi criado. Corrija:\n" + plano.erros.slice(0, 10).join("\n"));
    if (!plano.total) return out(ctx, "O JSON não tem nada para criar.");
    confirmarCriar(
      "Montar o servidor",
      "Vou criar " + plano.cargos.length + " cargos, " + plano.cats.length + " categorias e " + plano.nCanais + " canais neste servidor. O que já existir é pulado. Continuar?",
      function () { naFila(function () { return executarPlano(ctx, gid, plano); }); }
    );
  }

  function wikiTudo() {
    return [
      "**.criar tudo** (ou **.montar**)",
      "Cria cargos, categorias e canais de uma vez. Use o comando e, embaixo, um bloco de código com JSON:",
      "",
      ".criar tudo",
      "```json",
      '{"cargos":[["Admin",6,"#e74c3c"],["Membro",2,"#random"]],"categorias":[{"nome":"COMUNIDADE","canais":["chat-geral",["Call Geral","voz"]]}]}',
      "```",
      '**Cargo:** ["Nome", número, "cor"] (a cor é opcional)',
      '**Canal:** "nome" (texto), ["nome","voz"] ou {"nome":"avisos","somente_leitura":true,"escrevem":["Moderador"],"topico":"texto"}',
      '**Categoria:** {"nome":"STAFF","privado_para":["Admin"],"canais":[...]}',
      'Canais fora de categoria vão em "canais". O que já existir é pulado e antes de criar aparece uma telinha para confirmar.',
    ].join("\n");
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
      // os dados salvos NÃO são apagados ao descarregar
    },
  };

  return Object.assign({ default: life }, life);
})()