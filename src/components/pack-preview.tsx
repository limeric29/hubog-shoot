/* The preview uses sample outputs from this project's original smoke run. */
/* eslint-disable @next/next/no-img-element */
import { Icon } from './icon';
import styles from './studio.module.css';

export function PackPreview() {
  return (
    <aside className={styles.preview} aria-label="Example listing pack">
      <details className={styles.exampleDetails} open>
        <summary className={styles.previewHeading}>
          <span>See what one photo can make.</span>
          <span className={styles.exampleBadge}>Example pack</span>
        </summary>
        <div>
          <div className={styles.contactSheet}>
            <figure className={styles.lifestyleExample}>
              <img src="/examples/lifestyle.jpg" alt="Calamansi juice beside fresh calamansi on a sunny wooden table" width="720" height="900" />
              <figcaption>Lifestyle photo</figcaption>
            </figure>
            <figure className={styles.mainExample}>
              <img src="/examples/main.jpg" alt="The sample calamansi bottle cut out on a white background" width="900" height="900" />
              <figcaption>Main photo</figcaption>
            </figure>
            <figure className={styles.promoExample}>
              <img src="/examples/promo.jpg" alt="A vertical calamansi promotion with a citrus backdrop" width="506" height="900" loading="lazy" />
              <figcaption>Promo photo</figcaption>
            </figure>
          </div>
          <div className={styles.packIncludes}>
            <span className={styles.packIcon}><Icon name="photo" /></span>
            <div><strong>Everything for your listing</strong><p>5 photos, captions, and listing text.</p></div>
          </div>
          <div className={styles.platforms} aria-label="Works for these selling channels">
            <span>Shopee</span><span>Lazada</span><span>TikTok Shop</span><span>Facebook</span>
          </div>
          <p className={styles.exampleNote}>Examples shown. Lifestyle and promo backgrounds are AI-generated.</p>
        </div>
      </details>
    </aside>
  );
}
