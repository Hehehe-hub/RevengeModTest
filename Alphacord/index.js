const { before } = vendetta.patcher;
const { findByProps } = vendetta.metro;

const MessageActions = findByProps("sendMessage", "editMessage");

const SUFFIX =
  "\n-# Este usuário está sendo procurado pelo FBI. [Saiba mais.](https://eclectic-marigold-1fe4c6.netlify.app)";

let unpatchSend;
let unpatchEdit;

function appendSuffix(msg) {
  if (!msg || typeof msg.content !== "string") return;
  if (!msg.content.trim() || msg.content.endsWith(SUFFIX)) return;

  msg.content = `${msg.content}${SUFFIX}`;
}

export default {
  onLoad: () => {
    unpatchSend = before("sendMessage", MessageActions, (args) => {
      if (args[1]) {
        appendSuffix(args[1]);
      }
    });

    unpatchEdit = before("editMessage", MessageActions, (args) => {
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
