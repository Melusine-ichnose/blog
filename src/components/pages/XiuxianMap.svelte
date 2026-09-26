<script lang="ts">
// 境界图谱组件：可视化展示十三阶境界及解锁状态

interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
}

const REALMS: Realm[] = [
	{ name: "淬体境", level: 1, requiredXp: 30, description: "凡胎锻骨，初窥门径" },
	{ name: "引气境", level: 2, requiredXp: 70, description: "引气入体，涤荡经脉" },
	{ name: "练气境", level: 3, requiredXp: 160, description: "吐纳天地灵气，气旋丹田" },
	{ name: "筑基境", level: 4, requiredXp: 400, description: "筑就道基，寿元增至两百载" },
	{ name: "金丹境", level: 5, requiredXp: 1000, description: "凝结金丹，首次小天劫降临" },
	{ name: "元婴境", level: 6, requiredXp: 2400, description: "元婴出窍，神识覆盖千里" },
	{ name: "化神境", level: 7, requiredXp: 5500, description: "化神归一，可移山填海" },
	{ name: "炼虚境", level: 8, requiredXp: 12000, description: "炼神返虚，触摸法则边缘" },
	{ name: "合体境", level: 9, requiredXp: 26000, description: "天人合一，万法归宗" },
	{ name: "洞虚境", level: 10, requiredXp: 55000, description: "洞彻虚空，初解因果之秘" },
	{ name: "大乘境", level: 11, requiredXp: 110000, description: "大乘度世，因果秘术加身" },
	{ name: "渡劫境", level: 12, requiredXp: 230000, description: "渡九九天劫，成就不灭之躯" },
	{ name: "真仙境", level: 13, requiredXp: Infinity, description: "破碎飞升，与天地同寿" },
];

// 旧九阶索引 → 十三阶索引
const REALM_MIGRATION = [2, 3, 4, 5, 6, 8, 11, 10, 12];
let currentRealmIndex = $state(0);

if (typeof localStorage !== "undefined") {
	// 新档 v6 优先，回退兼容 v1 旧档
	const raw = localStorage.getItem("xiuxian_save_v6") ?? localStorage.getItem("xiuxian_save_v1");
	if (raw) {
		try {
			const data = JSON.parse(raw);
			const idx = data.realmIndex ?? 0;
			currentRealmIndex = data.schemaV === 2 ? idx : (REALM_MIGRATION[idx] ?? idx);
		} catch {}
	}
}
</script>

<div class="space-y-3">
  {#each REALMS as realm, i}
    <div
      class="flex items-center gap-4 p-4 rounded-lg border transition-all
        {i <= currentRealmIndex
          ? 'border-(--primary) bg-(--primary)/5'
          : 'border-(--line-divider) opacity-50'}"
    >
      <div
        class="w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0
          {i <= currentRealmIndex ? 'bg-(--primary) text-white' : 'bg-(--btn-regular-bg) text-(--content-meta)'}"
      >
        {realm.level}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold {i <= currentRealmIndex ? 'text-(--primary)' : ''}">
          {realm.name}
          {#if i === currentRealmIndex}
            <span class="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-(--primary) text-white">当前</span>
          {/if}
          {#if i < currentRealmIndex}
            <span class="ml-2 text-xs font-normal text-green-500">已突破</span>
          {/if}
        </div>
        <div class="text-sm text-(--content-meta) mt-0.5">{realm.description}</div>
      </div>
      <div class="text-xs text-(--content-meta) shrink-0 font-mono">
        {realm.requiredXp === Infinity ? "圆满" : realm.requiredXp.toLocaleString() + " 修为"}
      </div>
    </div>
  {/each}
</div>
