import type { ActivityView, ActivityCardView } from '@/app/lib/model/view/activity';

export function toActivityCardView(vm: ActivityView): ActivityCardView {
  return {
    id: vm.id,
    imageUrl: vm.imageUrl,
    category: vm.category,
    title: vm.title,
    time: vm.time,
    duration: vm.duration,
    guestsCount: vm.guestsCount,
    priceMin: vm.priceMin,
    priceMax: vm.priceMax,
  };
}
