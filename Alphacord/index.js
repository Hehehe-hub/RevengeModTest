
((vendetta) => {
    const { logger } = vendetta;
    const { findByProps } = vendetta.metro;

    const PREFIX = ".";
    const API = "https://discord.com/api/v10";

    const CLYDE =
        "OK, GRANDIOSO MESTRE FARMADOR DE AURA DESTRUIDOR DE UNIVERSOS QUE NÃO ENTENDE PORRA NENHUMA DE KOTLIN";

    let unpatch = null;
    let MessageActions = null;
    let RestAPI = null;
    let ChannelStore = null;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function getBody(result) {
        return result?.body ?? result;
    }

    function getGuild(channelId) {
        const channel = ChannelStore?.getChannel?.(channelId);

        if (!channel?.guild_id) {
            throw new Error("Não consegui identificar o servidor deste canal.");
        }

        return channel.guild_id;
    }

    async function request(method, path, body) {
        if (!RestAPI) {
            throw new Error("Módulo REST não encontrado.");
        }

        const fn = RestAPI[method];

        if (typeof fn !== "function") {
            throw new Error("Método REST indisponível: " + method);
        }

        const options = { url: API + path };

        if (body !== undefined) options.body = body;

        return getBody(await fn.call(RestAPI, options));
    }

    function tokenize(input) {
        const result = [];
        const regex = /"((?:\\.|[^"\\])*)"|(\S+)/g;
        let match;

        while ((match = regex.exec(input)) !== null) {
            result.push(
                (match[1] ?? match[2]).replace(/\\"/g, '"')
            );
        }

        return result;
    }

    function parseColor(value) {
        if (!value || value.toLowerCase() === "#random") {
            return Math.floor(Math.random() * 16777215);
        }

        if (!/^#[0-9a-f]{6}$/i.test(value)) {
            throw new Error("Use uma cor #RRGGBB ou #random.");
        }

        return parseInt(value.slice(1), 16);
    }

    const profiles = {
        1: { name: "Cosmético", permissions: "0" },
        2: { name: "Membro", permissions: "67584" },
        3: { name: "Staff", permissions: "9216" },
        4: { name: "ADM", permissions: "8" }
    };

    async function createCategory(guildId, name) {
        return request("post", `/guilds/${guildId}/channels`, {
            name,
            type: 4
        });
    }

    async function createChannel(guildId, name, categoryId, description) {
        const body = { name, type: 0 };

        if (categoryId) body.parent_id = categoryId;
        if (description) body.topic = description;

        return request("post", `/guilds/${guildId}/channels`, body);
    }

    async function createRole(guildId, name, color, profile) {
        const selected = profiles[profile];

        if (!selected) {
            throw new Error("Perfil inválido. Use 1, 2, 3 ou 4.");
        }

        return request("post", `/guilds/${guildId}/roles`, {
            name,
            color,
            permissions: selected.permissions
        });
    }

    async function findChannel(guildId, name) {
        const channels = await request(
            "get",
            `/guilds/${guildId}/channels`
        );

        return channels.find(
            channel => channel.name.toLowerCase() === name.toLowerCase()
        );
    }

    async function findRole(guildId, name) {
        const roles = await request(
            "get",
            `/guilds/${guildId}/roles`
        );

        return roles.find(
            role => role.name.toLowerCase() === name.toLowerCase()
        );
    }

    async function deleteChannel(guildId, name) {
        const channel = await findChannel(guildId, name);

        if (!channel) throw new Error("Canal não encontrado: " + name);

        await request("del", `/channels/${channel.id}`);
    }

    async function deleteCategory(guildId, name) {
        const channel = await findChannel(guildId, name);

        if (!channel || channel.type !== 4) {
            throw new Error("Categoria não encontrada: " + name);
        }

        await request("del", `/channels/${channel.id}`);
    }

    async function deleteRole(guildId, name) {
        const role = await findRole(guildId, name);

        if (!role) throw new Error("Cargo não encontrado: " + name);

        await request("del", `/guilds/${guildId}/roles/${role.id}`);
    }

    function parseBatch(source) {
        const items = [];
        const lines = source.split(/\r?\n/);
        let category = null;

        for (const raw of lines) {
            const line = raw.trim();

            if (!line || line === "{") continue;

            if (line === "}") {
                category = null;
                continue;
            }

            const categoryMatch = line.match(
                /^categoria\s+(.+?)\s*\{$/i
            );

            if (categoryMatch) {
                category = categoryMatch[1].trim();
                items.push({ type: "category", name: category });
                continue;
            }

            const channelMatch = line.match(
                /^canal\s+(.+?)(?:\s+"((?:\\.|[^"\\])*)")?$/i
            );

            if (channelMatch) {
                items.push({
                    type: "channel",
                    name: channelMatch[1].trim(),
                    category,
                    description: (channelMatch[2] || "")
                        .replace(/\\"/g, '"')
                });
            }
        }

        if (!items.length) {
            throw new Error("Nenhuma categoria ou canal encontrado.");
        }

        return items;
    }

    async function executeBatch(guildId, source) {
        const items = parseBatch(source);
        const categories = {};
        let createdCategories = 0;
        let createdChannels = 0;

        for (const item of items) {
            if (item.type !== "category") continue;

            const created = await createCategory(guildId, item.name);
            categories[item.name] = created.id;
            createdCategories++;

            await sleep(250);
        }

        for (const item of items) {
            if (item.type !== "channel") continue;

            const parentId = item.category
                ? categories[item.category]
                : null;

            if (item.category && !parentId) {
                throw new Error(
                    "Categoria não encontrada no lote: " + item.category
                );
            }

            await createChannel(
                guildId,
                item.name,
                parentId,
                item.description
            );

            createdChannels++;
            await sleep(250);
        }

        return (
            "✅ Lote concluído!\n\n" +
            "Categorias criadas: " + createdCategories + "\n" +
            "Canais criados: " + createdChannels
        );
    }

    function help() {
        return (
            "📚 ALPHACORD | COMANDOS\n\n" +
            ".help\n" +
            ".wiki\n" +
            ".create\n" +
            '.criar canal "Nome" "Categoria" "Descrição"\n' +
            ".deletar canal Nome\n" +
            ".criar categoria Nome\n" +
            ".deletar categoria Nome\n" +
            ".criar cargo Nome #random 1\n" +
            ".deletar cargo Nome\n\n" +
            "Perfis de cargo:\n" +
            "1 Cosmético\n2 Membro\n3 Staff\n4 ADM\n\n" +
            "#random = cor aleatória"
        );
    }

    function wiki() {
        return (
            "# ALPHACORD WIKI\n\n" +
            "## Canais\n" +
            "Use .criar canal e .deletar canal.\n\n" +
            "## Categorias\n" +
            "Use .criar categoria e .deletar categoria.\n\n" +
            "## Cargos\n" +
            "Use .criar cargo com nome, cor e perfil.\n\n" +
            "## Lote\n" +
            "Use .create seguido de um bloco de categorias e canais."
        );
    }

    async function executeCommand(channelId, command) {
        const text = command.trim();

        // Ajuda e wiki não precisam consultar o servidor.
        if (text === ".help") return help();
        if (text === ".wiki") return wiki();

        const guildId = getGuild(channelId);

        if (text.startsWith(".create")) {
            const source = text.slice(".create".length).trim();

            if (!source) {
                throw new Error("Adicione a configuração depois de .create.");
            }

            return executeBatch(guildId, source);
        }

        const match = text.match(
            /^\.criar\s+(canal|categoria|cargo)\s+([\s\S]+)$/i
        );

        if (match) {
            const type = match[1].toLowerCase();
            const args = tokenize(match[2]);

            if (!args.length) throw new Error("Nome não informado.");

            if (type === "categoria") {
                await createCategory(guildId, args.join(" "));
                return "📁 Categoria criada: " + args.join(" ");
            }

            if (type === "canal") {
                const name = args[0];
                const categoryName = args[1] || "";
                const description = args.slice(2).join(" ");

                let parentId = null;

                if (categoryName) {
                    const category = await findChannel(
                        guildId,
                        categoryName
                    );

                    if (!category || category.type !== 4) {
                        throw new Error("Categoria não encontrada.");
                    }

                    parentId = category.id;
                }

                await createChannel(
                    guildId,
                    name,
                    parentId,
                    description
                );

                return "📁 Canal criado: " + name;
            }

            if (type === "cargo") {
                const name = args[0];
                const color = parseColor(args[1]);
                const profile = Number(args[2] || 1);

                await createRole(guildId, name, color, profile);
                return "🏷️ Cargo criado: " + name;
            }
        }

        const remove = text.match(
            /^\.deletar\s+(canal|categoria|cargo)\s+(.+)$/i
        );

        if (remove) {
            const type = remove[1].toLowerCase();
            const name = remove[2].trim();

            if (type === "canal") {
                await deleteChannel(guildId, name);
            } else if (type === "categoria") {
                await deleteCategory(guildId, name);
            } else {
                await deleteRole(guildId, name);
            }

            return "🗑️ Removido: " + name;
        }

        throw new Error("Comando desconhecido. Digite .help.");
    }

    async function sendResult(channelId, content) {
        return MessageActions.sendMessage(
            channelId,
            {
                content,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            },
            true,
            {}
        );
    }

    function start() {
        MessageActions = findByProps("sendMessage", "editMessage");
        RestAPI = findByProps("get", "post", "del");
        ChannelStore = findByProps("getChannel");

        if (!MessageActions?.sendMessage) {
            throw new Error("MessageActions não encontrado.");
        }

        if (!RestAPI?.post || !RestAPI?.get || !RestAPI?.del) {
            throw new Error("RestAPI não encontrado ou incompleto.");
        }

        if (!ChannelStore?.getChannel) {
            throw new Error("ChannelStore não encontrado.");
        }

        logger.log("[Alphacord] Instalando interceptador...");

        // ORDEM CORRETA DA API LEGADA DO VENDETTA:
        // before(nomeDoMetodo, objeto, callback)
        unpatch = vendetta.patcher.before(
            "sendMessage",
            MessageActions,
            (_this, args) => {
                const channelId = args[0];
                const message = args[1];

                const content = typeof message === "string"
                    ? message
                    : message?.content;

                if (
                    typeof content !== "string" ||
                    !content.trim().startsWith(PREFIX)
                ) {
                    return;
                }

                const command = content.trim();

                if (typeof message === "string") {
                    args[1] = CLYDE;
                } else {
                    args[1] = {
                        ...message,
                        content: CLYDE
                    };
                }

                logger.log("[Alphacord] Comando detectado:", command);

                setTimeout(async () => {
                    try {
                        const result = await executeCommand(
                            channelId,
                            command
                        );

                        await sendResult(channelId, result);
                    } catch (error) {
                        logger.error("[Alphacord]", error);

                        await sendResult(
                            channelId,
                            "❌ Alphacord: " +
                            (error?.message || String(error))
                        );
                    }
                }, 700);
            }
        );

        logger.log("[Alphacord] Interceptador instalado!");
    }

    return {
        onLoad() {
            try {
                start();
            } catch (error) {
                logger.error("[Alphacord] Falha ao iniciar:", error);
            }
        },

        onUnload() {
            if (typeof unpatch === "function") {
                unpatch();
                unpatch = null;
            }

            logger.log("[Alphacord] Descarregado.");
        }
    };
})(vendetta);
