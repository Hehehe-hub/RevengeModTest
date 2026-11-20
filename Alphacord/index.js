(() => {
    const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const CHAVE    = "XQMZLPWCVNABCDEFGHIJKORSTU";

    function cifrarTexto(texto) {
        return texto.split("").map(char => {
            const isLower = char >= "a" && char <= "z";
            const upperChar = char.toUpperCase();
            const index = ALFABETO.indexOf(upperChar);
            if (index === -1) return char;
            const substituido = CHAVE[index];
            return isLower ? substituido.toLowerCase() : substituido;
        }).join("");
    }

    let unpatch;

    return {
        onLoad() {
            const MessageActions = vendetta.metro.findByProps("sendMessage", "receiveMessage");
            if (MessageActions) {
                unpatch = vendetta.patcher.before("sendMessage", MessageActions, (args) => {
                    if (args[1] && typeof args[1].content === "string") {
                        args[1].content = cifrarTexto(args[1].content);
                    }
                });
            }
        },
        onUnload() {
            if (unpatch) unpatch();
        }
    };
})();
