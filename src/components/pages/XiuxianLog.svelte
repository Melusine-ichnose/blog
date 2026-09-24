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
	lastBreakthrough: string | null;
	totalCultivations: number;
	log: LogEntry[];
}

const STORAGE_KEY = "xiuxian_save_v1";
const REALMS = ["炼气期","筑基期","金丹期","元婴期","化神期","合体期","渡劫期","大乘期","飞升境"];

let player = $state<PlayerState | null>(null);

if (typeof localStorage !== "undefined") {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) {
		try {
			player = JSON.parse(raw);
		} catch {
			player = null;
		}
	}
}

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
      当前境界：<span class="font-bold text-(--primary)">{REALMS[player.realmIndex]}</span>
      · 修为 {player.xp.toLocaleString()}
      · 累计修炼 {player.totalCultivations} 次
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
