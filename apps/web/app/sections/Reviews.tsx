export interface ReviewsProps {
  rating?: number;
  reviewCount?: number;
  yandexMapsUrl?: string;
}

const DEFAULT_YANDEX_URL =
  "https://yandex.ru/maps/org/tsvetnye_gory/";

export function Reviews({
  rating = 4.9,
  reviewCount,
  yandexMapsUrl = DEFAULT_YANDEX_URL,
}: ReviewsProps) {
  return (
    <section className="flex justify-end pt-0.5 px-4">
      <a
        href={yandexMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-ink-mid hover:text-ink transition-colors"
      >
        {rating}★ Отзывы на Яндекс Картах →
      </a>
    </section>
  );
}

export default Reviews;
