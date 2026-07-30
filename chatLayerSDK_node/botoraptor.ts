// FILE: chatLayerSDK_node/botoraptor.ts
// PURPOSE: Expose the public Botoraptor SDK class and shared API types from the implementation module.
// OWNS: Stable package-facing exports and compatibility aliases.
// EXPORTS: Botoraptor, ChatLayer, and SDK data types.
// DOCS: .agents/reports/plan_multi-filter_2026-07-31.md, docs/core/server.md

export { Botoraptor as default, Botoraptor, ChatLayer } from "./chatLayerSDK";
export type {
    Attachment,
    BotoraptorConfig,
    ChatLayerConfig,
    Message,
    MessageType,
    RoomInfo,
    User,
    FilterOptions
} from "./chatLayerSDK";
