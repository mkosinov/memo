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
    <section className="flex items-center gap-2 py-2 px-4">
      <span className="text-sm text-ink-mid">
        Хорошее место {rating}★
      </span>
      <span className="text-sm text-ink-mid">·</span>
      <a
        href={yandexMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-ink-mid hover:text-ink transition-colors"
      >
        Посмотреть отзывы <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}

export default Reviews;
