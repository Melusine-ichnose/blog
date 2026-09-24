<script lang="ts">
// 境界图谱组件：可视化展示九大境界及解锁状态

interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
}

const REALMS: Realm[] = [
	{ name: "炼气期", level: 1, requiredXp: 100, description: "初入修仙之门，吐纳天地灵气" },
	{ name: "筑基期", level: 2, requiredXp: 300, description: "筑基成功，寿元增至两百载" },
	{ name: "金丹期", level: 3, requiredXp: 800, description: "凝结金丹，可御剑飞行" },
	{ name: "元婴期", level: 4, requiredXp: 2000, description: "元婴出窍，神识覆盖千里" },
	{ name: "化神期", level: 5, requiredXp: 5000, description: "化神归一，可移山填海" },
	{ name: "合体期", level: 6, requiredXp: 12000, description: "天人合一，万法归宗" },
	{ name: "渡劫期", level: 7, requiredXp: 30000, description: "渡九九天劫，成就不灭之躯" },
	{ name: "大乘期", level: 8, requiredXp: 80000, description: "大乘圆满，可破碎虚空" },
	{ name: "飞升境", level: 9, requiredXp: Infinity, description: "飞升仙界，与天地同寿" },
];

const STORAGE_KEY = "xiuxian_save_v1";
let currentRealmIndex = $state(0);

if (typeof localStorage !== "undefined") {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) {
		try {
			currentRealmIndex = JSON.parse(raw).realmIndex ?? 0;
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
