(() => {
const PLUGIN_NAME = "Alphacord";

const DEFAULT_DATA = {
    version: 1,
    commands: [
        "criar canal",
        "deletar canal",
        "criar cargo",
        "deletar cargo",
        "criar categoria",
        "deletar categoria",
        "help",
        "wiki",
        "create"
    ],
    presets: {
        1: { name: "Cosmético", permissions: [] },
        2: { name: "Membro", permissions: [] },
        3: { name: "Staff", permissions: [] },
        4: { name: "ADM", permissions: [] }
    },
    drafts: []
};

let data = DEFAULT_DATA;
let storage;
let stopped = false;

const randomColor = () =>
    "#" + Math.floor(Math.random() * 16777215)
        .toString(16).padStart(6, "0");

function save() {
    try {
        if (storage?.set) storage.set(data);
    } catch (e) {
        console.error("[Alphacord] Storage:", e);
    }
}

function reply(message) {
    console.log(
        "%c[Clyde] " + message,
        "color:#5865F2;font-weight:bold"
    );

    try {
        if (window.bunny?.api?.logger?.log) {
            window.bunny.api.logger.log(message);
        }
    } catch (_) {}
}

function parseQuoted(text) {
    const result = [];
    const regex = /"((?:\\.|[^"\\])*)"/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        result.push(match[1].replace(/\\"/g, '"'));
    }

    return result;
}

function parseCreate(source) {
    const result = [];
    const lines = source.split(/\r?\n/);

    let category = null;

    for (const raw of lines) {
        const line = raw.trim();

        if (!line || line === "{" || line === "}") continue;

        const categoryMatch = line.match(/^categoria\s+(.+?)\s*\{$/i);

        if (categoryMatch) {
            category = categoryMatch[1].trim();
            result.push({
                type: "category",
                name: category
            });
            continue;
        }

        const channelMatch = line.match(
            /^canal\s+(.+?)(?:\s+"((?:\\.|[^"\\])*)")?$/i
        );

        if (channelMatch) {
            result.push({
                type: "channel",
                name: channelMatch[1].trim(),
                category,
                description: channelMatch[2] || ""
            });
        }
    }

    return result;
}

function validateCreate(items) {
    if (!items.length) {
        throw new Error("Nenhuma categoria ou canal encontrado.");
    }

    const names = new Set();

    for (const item of items) {
        if (!item.name) {
            throw new Error("Foi encontrado um nome vazio.");
        }

        const key = item.type + ":" + item.name.toLowerCase();

        if (names.has(key)) {
            throw new Error("Nome duplicado: " + item.name);
        }

        names.add(key);
    }

    return true;
}

function executeCreate(source) {
    try {
        const items = parseCreate(source);

        validateCreate(items);

        data.drafts.push({
            date: new Date().toISOString(),
            items
        });

        save();

        const categories = items.filter(
            item => item.type === "category"
        ).length;

        const channels = items.filter(
            item => item.type === "channel"
        ).length;

        reply(
            "Configuração interpretada!\n" +
            "Categorias: " + categories + "\n" +
            "Canais: " + channels + "\n\n" +
            "Esta versão guarda o projeto localmente. " +
            "Ainda não cria os elementos no servidor."
        );

    } catch (error) {
        reply("Erro: " + error.message);
    }
}

function help() {
    reply(
`📚 ALPHACORD

COMANDOS DISPONÍVEIS

.criar canal {nome}
.deletar canal {nome}

.criar categoria {nome}
.deletar categoria {nome}

.criar cargo {nome} {cor} {permissão}
.deletar cargo {nome}

.help
.wiki
.create

Cor especial: #random

Permissões:
1 = Cosmético
2 = Membro
3 = Staff
4 = ADM`
    );
}

function wiki() {
    reply(
`# ALPHACORD WIKI

## 1. Introdução

Alphacord é um sistema de organização
e administração de servidores Discord.

## 2. Canais

.criar canal {nome}

Recebe o nome do canal que deseja criar.

.deletar canal {nome}

Recebe o nome do canal que deseja excluir.

## 3. Categorias

.criar categoria {nome}

Define uma categoria.

.deletar categoria {nome}

Remove uma categoria.

## 4. Cargos

.criar cargo {nome} {cor} {nível}

A cor pode ser hexadecimal ou #random.

Níveis:
1. Cosmético
2. Membro
3. Staff
4. ADM

## 5. Criador em lote

.create

Permite interpretar várias categorias e canais
em uma única estrutura.

Descrições devem ficar entre aspas.

## 6. Ajuda

.help

Exibe a lista resumida dos comandos.

## 7. Persistência

Os projetos interpretados são armazenados
no armazenamento local do plugin.`
    );
}

function processCommand(input) {
    if (stopped || typeof input !== "string") return false;

    const text = input.trim();

    if (!text.startsWith(".")) return false;

    const command = text.slice(1).trim();

    if (command === "help") {
        help();
        return true;
    }

    if (command === "wiki") {
        wiki();
        return true;
    }

    if (command.startsWith("create")) {
        reply("Use o interpretador executeCreate() com o bloco de configuração.");
        return true;
    }

    if (command.startsWith("criar cargo ")) {
        const args = command.slice(12).trim().split(/\s+/);
        const name = args.shift();
        const color = args.shift() || "#random";
        const level = Number(args.shift() || 1);

        if (!name || !data.presets[level]) {
            reply("Sintaxe inválida. Nível permitido: 1, 2, 3 ou 4.");
            return true;
        }

        const role = {
            name,
            color: color === "#random" ? randomColor() : color,
            preset: level,
            permissions: data.presets[level].permissions
        };

        data.drafts.push({ type: "role", ...role });
        save();

        reply(
            "Cargo preparado: " + name +
            "\nCor: " + role.color +
            "\nPerfil: " + data.presets[level].name +
            "\nAinda não criado no servidor."
        );

        return true;
    }

    const operations = [
        "criar canal",
        "deletar canal",
        "criar categoria",
        "deletar categoria",
        "deletar cargo"
    ];

    for (const operation of operations) {
        if (command.startsWith(operation + " ")) {
            const name = command.slice(operation.length).trim();

            if (!name) {
                reply("Informe um nome.");
                return true;
            }

            data.drafts.push({
                operation,
                name,
                date: new Date().toISOString()
            });

            save();

            reply(
                "Operação registrada localmente: " +
                operation + " → " + name +
                "\nAinda não executada no servidor."
            );

            return true;
        }
    }

    return false;
}

function onLoad() {
    stopped = false;

    try {
        storage = window.bunny?.plugin?.createStorage?.();

        if (storage?.get) {
            const saved = storage.get();

            if (saved && typeof saved === "object") {
                data = {
                    ...DEFAULT_DATA,
                    ...saved
                };
            }
        }
    } catch (e) {
        console.log("[Alphacord] Storage indisponível:", e);
    }

    console.log("[Alphacord] Carregado.");
    console.log("[Alphacord] Comandos:", data.commands);
}

function onUnload() {
    stopped = true;
    save();
    console.log("[Alphacord] Descarregado.");
}

return {
    onLoad,
    onUnload
};
})();