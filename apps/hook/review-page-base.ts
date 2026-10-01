/**
 * Fork: a Review page served under `/plannotator/session/<review_id>/` calls its API,
 * event streams and images there instead of at the site root. Imported first by the
 * page entry; a plain `plannotator annotate` page is left as upstream wrote it.
 */
import { installReviewPageBase } from '@plannotator/shared/review-api/page-base';
import { defaultImageSrcResolver, setImageSrcResolver } from '@plannotator/ui/components/ImageThumbnail';

const rebaseApiUrl = installReviewPageBase(window);
if (rebaseApiUrl) {
  setImageSrcResolver((path, base) => rebaseApiUrl(defaultImageSrcResolver(path, base)));
}
