/**
 * Fork: a Review page served under `/plannotator/session/<review_id>/` calls its API,
 * event streams and images there instead of at the site root, sends its Round with
 * its Round-checked commands, closes when that Round is over for it, and lists the
 * Remarks it sent with their Replies. Imported first by the page entry; a plain
 * `plannotator annotate` page is left as upstream wrote it.
 */
import { installReviewPageBase } from '@plannotator/shared/review-api/page-base';
import { installReviewPageRound } from '@plannotator/shared/review-api/page-round';
import { defaultImageSrcResolver, setImageSrcResolver } from '@plannotator/ui/components/ImageThumbnail';
import { setSentRemarksSource } from '@plannotator/ui/components/SentRemarks';
import { showReviewPageClosure } from './review-page-closure';
import { loadSentRemarks } from './review-page-replies';

const rebaseApiUrl = installReviewPageBase(window);
if (rebaseApiUrl) {
  setImageSrcResolver((path, base) => rebaseApiUrl(defaultImageSrcResolver(path, base)));
  installReviewPageRound(window, showReviewPageClosure);
  setSentRemarksSource(() => loadSentRemarks((input) => window.fetch(input), window.location.pathname));
}
