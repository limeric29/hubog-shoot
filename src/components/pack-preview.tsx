/* The preview uses sample outputs from this project's original smoke run. */
/* eslint-disable @next/next/no-img-element */
import { Icon } from './icon';
import styles from './studio.module.css';

export function PackPreview() {
  return (
    <aside className={styles.preview} aria-label="Example listing pack">
      <details className={styles.exampleDetails} open>
        <summary className={styles.previewHeading}>
          <span>One photo. A whole new look.</span>
          <span className={styles.exampleBadge}>Example pack</span>
        </summary>
        <div>
          <div className={styles.contactSheet}>
            <figure className={styles.lifestyleExample}>
              <img src="/examples/lifestyle.jpg" alt="Calamansi juice in an AI-made scene on a sunny wooden table" width="720" height="900" />
              <figcaption>Lifestyle scene</figcaption>
            </figure>
            <figure className={styles.mainExample}>
              <img src="/examples/main.jpg" alt="The sample calamansi bottle cut out on a white background" width="900" height="900" />
              <figcaption>Clean main image</figcaption>
            </figure>
            <figure className={styles.promoExample}>
              <img src="/examples/promo.jpg" alt="A vertical calamansi promo with an AI-made citrus backdrop" width="506" height="900" loading="lazy" />
              <figcaption>Social promo</figcaption>
            </figure>
          </div>
          <div className={styles.packIncludes}>
            <span className={styles.packIcon}><Icon name="photo" /></span>
            <div><strong>Your pack, ready to post</strong><p>5 photos, captions, and a product listing.</p></div>
          </div>
          <div className={styles.platforms} aria-label="Sized for your selling channels">
            <span>Shopee</span><span>Lazada</span><span>TikTok Shop</span><span>Facebook</span>
          </div>
          <p className={styles.exampleNote}>Sample output shown. Lifestyle and promo scenes are AI-made.</p>
        </div>
      </details>
    </aside>
  );
}
