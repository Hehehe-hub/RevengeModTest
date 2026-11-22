import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";

const MessageActions = findByProps("sendMessage", "editMessage");

const SUFFIX =
  "\n-# Este usuário está sendo procurado pelo FBI. [Saiba mais.](https://eclectic-marigold-1fe4c6.netlify.app)";

let unpatchSend: (() => void) | undefined;
let unpatchEdit: (() => void) | undefined;

function appendSuffix(msg: { content?: string }) {
  if (!msg || typeof msg.content !== "string") return;

  // Evita duplicar caso já tenha o sufixo
  if (!msg.content.endsWith(SUFFIX)) {
    msg.content = `${msg.content}${SUFFIX}`;
  }
}

export default {
  onLoad: () => {
    unpatchSend = before("sendMessage", MessageActions, (args) => {
      // args[1] costuma ser o objeto da mensagem { content: "...", ... }
      if (args[1]) {
        appendSuffix(args[1]);
      }
    });

    unpatchEdit = before("editMessage", MessageActions, (args) => {
      // args[2] costuma ser o objeto atualizado { content: "..." }
      if (args[2]) {
        appendSuffix(args[2]);
      }
    });
  },

  onUnload: () => {
    unpatchSend?.();
    unpatchEdit?.();
  },
};
