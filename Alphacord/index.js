
((vendetta) => {
    const plugin = vendetta.plugin;
    const logger = vendetta.logger;

    const commands = [];
    const storage = plugin.storage;

    const DEFAULT_DATA = {
        drafts: [],
        categories: [],
        channels: [],
        roles: []
    };

    // Storage
    Object.keys(DEFAULT_DATA).forEach(key => {
        if (!Array.isArray(storage[key])) {
            storage[key] = DEFAULT_DATA[key].slice();
        }
    });

    function save() {
        try {
            Object.keys(storage).forEach(() => {});
        } catch (e) {
            logger.error("[Alphacord] Storage error:", e);
        }
    }

    // Helpers
    function arg(args, name, fallback = "") {
        const item = (args || []).find(x => x.name === name);
        return item?.value ?? fallback;
    }

    function randomColor() {
        return "#" + Math.floor(Math.random() * 16777215)
            .toString(16).padStart(6, "0");
    }

    function validColor(color) {
        return /^#[0-9a-fA-F]{6}$/.test(color);
    }

    function record(operation, details) {
        const entry = {
            operation,
            details,
            createdAt: new Date().toISOString()
        };

        storage.drafts.push(entry);
        save();

        return entry;
    }

    function response(text) {
        return { content: text };
    }

    // Create parser
    function parseCreate(source) {
        const lines = source.split(/\r?\n/);
        const result = [];
        let currentCategory = null;

        for (let raw of lines) {
            const line = raw.trim();

            if (!line || line === "{" || line === "}") {
                if (line === "}") currentCategory = null;
                continue;
            }

            const categoryMatch = line.match(
                /^categoria\s+(.+?)\s*\{$/i
            );

            if (categoryMatch) {
                currentCategory = categoryMatch[1].trim();

                result.push({
                    type: "category",
                    name: currentCategory
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
                    category: currentCategory,
                    description: (channelMatch[2] || "")
                        .replace(/\\"/g, '"')
                });
            }
        }

        return result;
    }

    function validateCreate(items) {
        if (!items.length) {
            throw new Error("Nenhum elemento encontrado.");
        }

        const names = new Set();

        for (const item of items) {
            if (!item.name) {
                throw new Error("Nome vazio encontrado.");
            }

            const key = item.type + ":" +
                item.name.toLowerCase();

            if (names.has(key)) {
                throw new Error("Elemento duplicado: " + item.name);
            }

            names.add(key);
        }
    }

    function executeCreate(source) {
        try {
            const items = parseCreate(source);

            validateCreate(items);

            record("create-batch", items);

            const categories = items.filter(
                x => x.type === "category"
            ).length;

            const channels = items.filter(
                x => x.type === "channel"
            ).length;

            return response(
                "🥶 ALPHACORD | Clyde\n\n" +
                "Configuração interpretada com sucesso!\n\n" +
                "Categorias: " + categories + "\n" +
                "Canais: " + channels + "\n\n" +
                "Elementos preparados e salvos localmente."
            );

        } catch (error) {
            return response(
                "❌ Erro de configuração:\n" + error.message
            );
        }
    }

    // Help
    function help() {
        return response(
`📚 ALPHACORD | COMANDOS

.help
.wiki

.create
.criar-canal
.deletar-canal
.criar-categoria
.deletar-categoria
.criar-cargo
.deletar-cargo

CORES:
#random = cor aleatória

PERFIS:
1 = Cosmético
2 = Membro
3 = Staff
4 = ADM

Use o comando para consultar suas opções.`
        );
    }

    // Wiki
    function wiki() {
        return response(
`# ALPHACORD WIKI

## 1. Introdução

Alphacord é um sistema de organização
de servidores Discord.

Esta edição possui um sistema local de
interpretação e armazenamento de projetos.

## 2. Gerenciamento de canais

### Criar canal

/criar-canal

Parâmetros:
- nome: nome do canal.
- categoria: categoria desejada.
- descrição: descrição do canal.

### Deletar canal

/deletar-canal

Parâmetros:
- nome: nome do canal.

## 3. Categorias

/criar-categoria
/deletar-categoria

Recebem o nome da categoria.

## 4. Cargos

/criar-cargo

Parâmetros:
- nome: nome do cargo.
- cor: cor hexadecimal.
- perfil: nível de permissões desejado.

### Perfis disponíveis

1. Cosmético
2. Membro
3. Staff
4. ADM

Os perfis são identificadores locais nesta edição.

## 5. Criador em lote

/create

Aceita uma configuração contendo categorias
e canais.

Exemplo:

categoria Comunidade {
  canal Chat "Converse aqui!"
  canal Memes "Envie memes!"
}

Descrições são colocadas entre aspas.

## 6. Persistência

As configurações são guardadas no armazenamento
do plugin e não desaparecem quando um comando
é executado.

## 7. Ajuda

/help

Exibe a lista resumida dos comandos.`
        );
    }

    // Command builder
    function register(name, description, options, execute) {
        const command = {
            name,
            displayName: name,
            description,
            displayDescription: description,
            applicationId: "-1",
            inputType: 1,
            type: 1,
            options: options || [],
            execute
        };

        const unregister =
            vendetta.commands.registerCommand(command);

        if (typeof unregister === "function") {
            commands.push(unregister);
        }
    }

    const STRING = 3;

    function option(name, description, required = true) {
        return {
            name,
            displayName: name,
            description,
            displayDescription: description,
            type: STRING,
            required
        };
    }

    // Commands
    function registerAll() {

        register(
            "help",
            "Exibe todos os comandos Alphacord.",
            [],
            () => help()
        );

        register(
            "wiki",
            "Manual detalhado do Alphacord.",
            [],
            () => wiki()
        );

        register(
            "create",
            "Interpreta uma configuração em lote.",
            [option("config", "Configuração completa.")],
            args => executeCreate(arg(args, "config"))
        );

        register(
            "criar-canal",
            "Prepara a criação de um canal.",
            [
                option("nome", "Nome do canal."),
                option("categoria", "Categoria do canal.", false),
                option("descricao", "Descrição do canal.", false)
            ],
            args => {
                const details = {
                    name: arg(args, "nome"),
                    category: arg(args, "categoria"),
                    description: arg(args, "descricao")
                };

                if (!details.name) {
                    return response("Informe o nome do canal.");
                }

                record("create-channel", details);

                return response(
                    "📁 Canal preparado: " + details.name +
                    "\nCategoria: " + (details.category || "Nenhuma") +
                    "\nDescrição: " + (details.description || "Nenhuma") +
                    "\n\nSalvo localmente."
                );
            }
        );

        register(
            "deletar-canal",
            "Prepara a exclusão de um canal.",
            [option("nome", "Nome do canal.")],
            args => {
                const name = arg(args, "nome");

                if (!name) return response("Informe o nome.");

                record("delete-channel", { name });

                return response(
                    "Canal marcado para exclusão: " + name
                );
            }
        );

        register(
            "criar-categoria",
            "Prepara a criação de uma categoria.",
            [option("nome", "Nome da categoria.")],
            args => {
                const name = arg(args, "nome");

                if (!name) return response("Informe o nome.");

                record("create-category", { name });

                return response(
                    "Categoria preparada: " + name
                );
            }
        );

        register(
            "deletar-categoria",
            "Prepara a exclusão de uma categoria.",
            [option("nome", "Nome da categoria.")],
            args => {
                const name = arg(args, "nome");

                if (!name) return response("Informe o nome.");

                record("delete-category", { name });

                return response(
                    "Categoria marcada para exclusão: " + name
                );
            }
        );

        register(
            "criar-cargo",
            "Prepara um cargo com cor e perfil.",
            [
                option("nome", "Nome do cargo."),
                option("cor", "Hexadecimal ou #random.", false),
                option("perfil", "1, 2, 3 ou 4.", false)
            ],
            args => {
                const name = arg(args, "nome");
                let color = arg(args, "cor", "#random");
                const profile = Number(arg(args, "perfil", "1"));

                if (!name) return response("Informe o nome.");

                if (color.toLowerCase() === "#random") {
                    color = randomColor();
                }

                if (!validColor(color)) {
                    return response(
                        "Cor inválida. Use #RRGGBB ou #random."
                    );
                }

                const profiles = {
                    1: "Cosmético",
                    2: "Membro",
                    3: "Staff",
                    4: "ADM"
                };

                if (!profiles[profile]) {
                    return response("Perfil inválido. Use 1 a 4.");
                }

                record("create-role", {
                    name,
                    color,
                    profile,
                    profileName: profiles[profile]
                });

                return response(
                    "🏷️ Cargo preparado: " + name +
                    "\nCor: " + color +
                    "\nPerfil: " + profiles[profile] +
                    "\n\nSalvo localmente."
                );
            }
        );

        register(
            "deletar-cargo",
            "Prepara a exclusão de um cargo.",
            [option("nome", "Nome do cargo.")],
            args => {
                const name = arg(args, "nome");

                if (!name) return response("Informe o nome.");

                record("delete-role", { name });

                return response(
                    "Cargo marcado para exclusão: " + name
                );
            }
        );
    }

    return {
        onLoad() {
            try {
                registerAll();
                logger.log("[Alphacord] Plugin carregado!");
                logger.log("[Alphacord] 9 comandos registrados.");
            } catch (error) {
                logger.error("[Alphacord] Falha:", error);
            }
        },

        onUnload() {
            while (commands.length) {
                try {
                    commands.pop()();
                } catch (_) {}
            }

            logger.log("[Alphacord] Plugin descarregado.");
        }
    };
})(vendetta)
