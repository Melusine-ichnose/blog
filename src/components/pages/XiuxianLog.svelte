<script lang="ts">
// 修炼日志组件：读取 localStorage 中的修仙存档，展示日志

interface LogEntry {
	time: string;
	message: string;
	type: "info" | "success" | "danger" | "warning";
}

interface PlayerState {
	xp: number;
	realmIndex: number;
	schemaV?: number;
	lastBreakthrough: string | null;
	totalCultivations?: number;
	totalBreaths?: number;
	log: LogEntry[];
}

const REALMS = ["淬体境","引气境","练气境","筑基境","金丹境","元婴境","化神境","炼虚境","合体境","洞虚境","大乘境","渡劫境","真仙境"];
// 旧九阶索引 → 十三阶索引
const REALM_MIGRATION = [2, 3, 4, 5, 6, 8, 11, 10, 12];

let player = $state<PlayerState | null>(null);

if (typeof localStorage !== "undefined") {
	const raw = localStorage.getItem("xiuxian_save_v6") ?? localStorage.getItem("xiuxian_save_v1");
	if (raw) {
		try {
			player = JSON.parse(raw);
		} catch {
			player = null;
		}
	}
}

const realmName = $derived.by(() => {
	if (!player) return "";
	const idx = player.realmIndex ?? 0;
	const realIdx = player.schemaV === 2 ? idx : (REALM_MIGRATION[idx] ?? idx);
	return REALMS[realIdx] ?? REALMS[0];
});
const cultivationCount = $derived(player?.totalBreaths ?? player?.totalCultivations ?? 0);

const typeColor: Record<string, string> = {
	info: "text-(--content-meta)",
	success: "text-green-500",
	danger: "text-red-500",
	warning: "text-amber-500",
};
</script>

{#if player}
  <div class="mb-6 p-4 rounded-lg bg-(--btn-regular-bg)">
    <div class="text-sm text-(--content-meta)">
      当前境界：<span class="font-bold text-(--primary)">{realmName}</span>
      · 修为 {player.xp.toLocaleString()}
      · 累计打坐 {cultivationCount} 息
    </div>
  </div>

  {#if player.log && player.log.length > 0}
    <div class="space-y-3">
      {#each player.log as entry}
        <div class="flex gap-3 text-sm">
          <span class="text-xs text-(--content-meta) shrink-0 w-36">{entry.time}</span>
          <span class={typeColor[entry.type]}>{entry.message}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-(--content-meta) text-sm">暂无修炼记录，去修炼面板开始第一次打坐吧。</p>
  {/if}
{:else}
  <p class="text-(--content-meta) text-sm">尚未开始修仙之旅，去修炼面板开始修炼吧。</p>
{/if}
