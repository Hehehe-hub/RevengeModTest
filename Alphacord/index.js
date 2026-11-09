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
      if (c.viaPrefix && MA) sendReal(c.channelId, p);
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
      desc: "Mostra todos os comandos do Alphacord",
      run: function (ctx) {
        const linhas = CMDS.map(function (c) {
          return "• `/" + c.name + "` ou `." + c.aliases.join("` / `.") + "`" + (c.usage ? " " + c.usage : "") + " — " + c.desc;
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
      name: "paginas",
      aliases: ["paginas", "abas"],
      desc: "Abre a Aba Páginas (suas anotações privadas)",
      run: function (ctx) {
        abrirPaginas(ctx);
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

      const m = text.match(/^\.([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
      const cmd = m && CMDS.find(function (c) { return c.aliases.indexOf(m[1].toLowerCase()) >= 0; });
      if (cmd) {
        pending = null;
        run(cmd, { channelId: channelId, viaPrefix: true }, parseArgs(m[2]));
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
      item: { padding: 14, marginHorizontal: 12, marginTop: 8, borderRadius: 8, backgroundColor: bg2 },
      itemTxt: { color: txt, fontSize: 16 },
      vazio: { color: mut, textAlign: "center", marginTop: 40 },
      mais: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: acc, alignItems: "center", justifyContent: "center" },
      maisTxt: { color: "#ffffff", fontSize: 30 },
      corpo: { padding: 16 },
      texto: { color: txt, fontSize: 16, lineHeight: 24 },
      codigo: { color: txt, backgroundColor: bg2, fontFamily: "monospace", fontSize: 15 },
      input: { color: txt, backgroundColor: bg2, borderRadius: 8, padding: 12, fontSize: 16, marginTop: 8 },
      barra: { flexDirection: "row", justifyContent: "flex-end", padding: 8 },
      btn: { color: acc, fontSize: 15, fontWeight: "bold", padding: 8 },
      fundo: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
      menu: { backgroundColor: bg2, padding: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
      menuItem: { padding: 14 },
    });
  }

  // Texto da página: o que estiver entre `crases` copia ao tocar
  function renderTexto(txt, S) {
    if (!txt) return h(RN.Text, { style: S.vazio }, "Página vazia. Toque em Editar para escrever.");
    const partes = txt.split(/(```[\s\S]*?```|`[^`\n]+`)/);
    return h(
      RN.Text,
      { style: S.texto },
      partes.map(function (p, i) {
        const bloco = p.length > 6 && p.indexOf("```") === 0;
        const inline = !bloco && p.length > 2 && p.charAt(0) === "`" && p.charAt(p.length - 1) === "`";
        if (!bloco && !inline) return p;
        const cod = bloco ? p.slice(3, -3).replace(/^\n/, "") : p.slice(1, -1);
        return h(RN.Text, { key: i, style: S.codigo, onPress: function () { copiar(cod); } }, " " + cod + " ");
      })
    );
  }

  function PaginasApp(props) {
    const S = React.useMemo(mkStyles, []);
    const force = React.useReducer(function (x) { return x + 1; }, 0)[1];
    const [caminho, setCaminho] = React.useState([]);
    const [pagina, setPagina] = React.useState(null);
    const [editando, setEditando] = React.useState(false);
    const [menu, setMenu] = React.useState(null);
    const [form, setForm] = React.useState(null);
    const [carregado, setCarregado] = React.useState(false);

    React.useEffect(function () {
      paginasReady.then(function () { setCarregado(true); });
      return function () { flushPaginas(); };
    }, []);

    const atual = caminho.length ? caminho[caminho.length - 1] : null;
    const nodePagina = pagina ? achar(pagina) : null;

    function irPara(n) {
      setPagina(null);
      setEditando(false);
      setCaminho(caminho.slice(0, n));
    }
    function voltar() {
      if (pagina) { setPagina(null); setEditando(false); }
      else if (caminho.length) setCaminho(caminho.slice(0, -1));
      else props.onClose();
    }
    function sair() {
      flushPaginas();
      props.onClose();
    }

    function confirmarForm() {
      const nome = (form.nome || "").trim();
      if (!nome) return toast("Escreva um nome");
      if (form.modo === "novo") {
        const agora = Date.now();
        const no = { uid: novoId(), pai: atual, tipo: form.tipo, nome: nome, conteudo: "", criadoEm: agora, editadoEm: agora };
        paginas.nodes.push(no);
        if (form.tipo === "pagina") { setPagina(no.uid); setEditando(true); }
      } else {
        const n = achar(form.id);
        if (n) { n.nome = nome; n.editadoEm = Date.now(); }
      }
      savePaginas();
      setForm(null);
      force();
    }

    function excluir(n) {
      const ids = {};
      [n].concat(descendentes(n.uid)).forEach(function (x) { ids[x.uid] = true; });
      paginas.nodes = paginas.nodes.filter(function (x) { return !ids[x.uid]; });
      if (pagina === n.uid) { setPagina(null); setEditando(false); }
      savePaginas();
      force();
    }
    function pedirExclusao(n) {
      const msg = n.tipo === "caminho"
        ? 'Excluir o caminho "' + n.nome + '" e tudo dentro dele (' + descendentes(n.uid).length + " itens)?"
        : 'Excluir a página "' + n.nome + '"?';
      RN.Alert.alert("Excluir", msg, [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir", style: "destructive", onPress: function () { excluir(n); } },
      ]);
    }

    function sheet(opcoes) {
      return h(
        RN.TouchableOpacity,
        { activeOpacity: 1, style: S.fundo, onPress: function () { setMenu(null); } },
        h(
          RN.View,
          { style: S.menu },
          opcoes.map(function (o, i) {
            return h(RN.TouchableOpacity, { key: i, style: S.menuItem, onPress: o[1] }, h(RN.Text, { style: S.itemTxt }, o[0]));
          })
        )
      );
    }

    // trilha: Aba Páginas | Testes | Testes Plugins | 1
    const migas = [{ label: "Aba Páginas", fn: function () { irPara(0); } }];
    caminho.forEach(function (id, i) {
      const n = achar(id);
      migas.push({ label: n ? n.nome : "?", fn: function () { irPara(i + 1); } });
    });
    if (nodePagina) migas.push({ label: nodePagina.nome });

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
    } else if (nodePagina) {
      corpo = h(
        RN.View,
        { style: { flex: 1 } },
        h(
          RN.View,
          { style: S.barra },
          h(RN.TouchableOpacity, { onPress: function () { setEditando(!editando); flushPaginas(); } }, h(RN.Text, { style: S.btn }, editando ? "Concluir" : "Editar")),
          h(RN.TouchableOpacity, { onPress: function () { setMenu({ id: nodePagina.uid }); } }, h(RN.Text, { style: S.btn }, "Mais"))
        ),
        editando
          ? h(
              RN.ScrollView,
              { style: S.corpo, keyboardShouldPersistTaps: "handled" },
              h(RN.TextInput, {
                style: S.input,
                multiline: true,
                defaultValue: nodePagina.conteudo || "",
                placeholder: "Escreva aqui. Use `crases` para texto que copia ao tocar.",
                placeholderTextColor: "#888888",
                onChangeText: function (t) {
                  nodePagina.conteudo = t;
                  nodePagina.editadoEm = Date.now();
                  savePaginasSoon();
                },
              })
            )
          : h(RN.ScrollView, { style: S.corpo }, renderTexto(nodePagina.conteudo || "", S))
      );
    } else {
      const lista = filhos(atual);
      corpo = h(
        RN.ScrollView,
        { style: { flex: 1 } },
        lista.length
          ? lista.map(function (n) {
              return h(
                RN.TouchableOpacity,
                {
                  key: n.uid,
                  style: S.item,
                  onPress: function () { if (n.tipo === "caminho") setCaminho(caminho.concat(n.uid)); else setPagina(n.uid); },
                  onLongPress: function () { setMenu({ id: n.uid }); },
                },
                h(RN.Text, { style: S.itemTxt }, n.tipo === "caminho" ? "[ " + n.nome + " ]" : "> " + n.nome)
              );
            })
          : h(RN.Text, { style: S.vazio }, "Vazio por aqui. Toque no + para adicionar."),
        h(RN.View, { style: { height: 100 } })
      );
    }

    let overlay = null;
    if (form) {
      overlay = h(
        RN.View,
        { style: S.fundo },
        h(
          RN.View,
          { style: S.menu },
          h(RN.Text, { style: S.itemTxt }, form.modo === "novo" ? (form.tipo === "pagina" ? "Nome da página" : "Nome do caminho") : "Novo nome"),
          h(RN.TextInput, {
            style: S.input,
            autoFocus: true,
            defaultValue: form.nome,
            onChangeText: function (t) { setForm(Object.assign({}, form, { nome: t })); },
          }),
          h(
            RN.View,
            { style: S.barra },
            h(RN.TouchableOpacity, { onPress: function () { setForm(null); } }, h(RN.Text, { style: S.btn }, "Cancelar")),
            h(RN.TouchableOpacity, { onPress: confirmarForm }, h(RN.Text, { style: S.btn }, "OK"))
          )
        )
      );
    } else if (menu === "mais") {
      overlay = sheet([
        ["Adicionar página", function () { setMenu(null); setForm({ modo: "novo", tipo: "pagina", nome: "" }); }],
        ["Adicionar caminho", function () { setMenu(null); setForm({ modo: "novo", tipo: "caminho", nome: "" }); }],
      ]);
    } else if (menu && menu.id) {
      const n = achar(menu.id);
      if (n) {
        overlay = sheet([
          ["Renomear", function () { setMenu(null); setForm({ modo: "renomear", id: n.uid, nome: n.nome }); }],
          ["Excluir", function () { setMenu(null); pedirExclusao(n); }],
        ]);
      }
    }

    return h(
      RN.View,
      { style: S.root },
      topo,
      corpo,
      carregado && !nodePagina
        ? h(RN.TouchableOpacity, { style: S.mais, onPress: function () { setMenu("mais"); } }, h(RN.Text, { style: S.maisTxt }, "+"))
        : null,
      overlay
    );
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
        return h(RN.Text, { style: { color: "#ed4245", padding: 16 } }, "Erro na Aba Páginas: " + (this.state.erro.message || this.state.erro));
      }
      return this.props.children;
    }
  }

  // Abertura 1: tela do plugin (Configurações > Plugins > Alphacord > engrenagem)
  function PaginasConfig() {
    let nav = null;
    try { nav = vendetta.metro.common.NavigationNative.useNavigation(); } catch (e) {}
    return h(
      RN.View,
      { style: { flex: 1 } },
      h(Barreira, null, h(PaginasApp, { onClose: function () { try { nav.goBack(); } catch (e) {} } }))
    );
  }

  // Abertura 2: .paginas ou /paginas (janela por cima do chat)
  function fecharPaginas() {
    flushPaginas();
    try { findByProps("openAlert", "dismissAlert").dismissAlert(ALERT_KEY); } catch (e) {}
  }
  function abrirPaginas(ctx) {
    try {
      const win = RN.Dimensions.get("window");
      findByProps("openAlert", "dismissAlert").openAlert(
        ALERT_KEY,
        h(
          RN.View,
          { style: { width: win.width, height: win.height * 0.85, overflow: "hidden", borderRadius: 12 } },
          h(Barreira, null, h(PaginasApp, { onClose: fecharPaginas }))
        )
      );
      return;
    } catch (e) {}
    out(ctx, "Não consegui abrir a aba por aqui. Abra em Configurações > Plugins > Alphacord (engrenagem).");
  }

  // ===== Ciclo de vida do plugin =====
  const life = {
    onLoad: function () {
      ready = loadDb().catch(function () {});
      paginasReady = loadPaginas().catch(function () {});

      CMDS.forEach(function (c) {
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
    settings: PaginasConfig,
  };

  return Object.assign({ default: life }, life);
})()
