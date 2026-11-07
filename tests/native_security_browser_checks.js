// Native acceptance checks for audit findings F-05, F-18 and F-23.
//
// These run against the real studio in headless Chrome and the isolated ComfyUI host.
// The XSS cases use only a local window counter: a crafted project value may render as
// text, but it must never execute the harmless marker. The media case uploads a real
// project-owned MP4 and PNG whose names hold "#", a literal "%41" and a literal "%",
// then loads, seeks and range-requests them through the actual host routes.
(async () => {
  const w = window,
    d = document,
    n = w.spoolNative,
    $ = id => d.getElementById(id),
    checks = [],
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async (label, fn, timeout = 30000) => {
      const end = Date.now() + timeout;
      while (!(await fn())) {
        if (Date.now() > end) throw Error(label + (n ? ' · ' + n.state?.project : ''));
        await sleep(100);
      }
    },
    marker = () => w.__nativeSecurityXss || 0,
    mediaUrl = relative =>
      '/spool/media/' + encodeURIComponent(n.projectKey) + '/' + relative.split('/').map(encodeURIComponent).join('/'),
    absoluteMediaUrl = relative => new URL(mediaUrl(relative), location.origin).href,
    caseName = w.__nativeSecurityCase || 'xss';

  if (caseName === 'xss-before') {
    await wait('Timeline did not render the before-fix fixture', () => d.querySelector('#clipLane [data-clip]'));
    check('The isolated before-fix renderer executes a crafted take number', marker() > 0);
    check(
      'The isolated before-fix renderer inserts the crafted handler image',
      d.querySelectorAll('#editor img[src="x"]').length > 0,
    );
    const banner = d.createElement('div');
    banner.id = 'nativeSecurityBeforeBanner';
    banner.textContent = 'F-05 before the fix: crafted take number executed window.__nativeSecurityXss=' + marker();
    banner.style.cssText =
      'position:fixed;left:24px;bottom:24px;z-index:2147483647;padding:12px 16px;background:#b91c1c;color:#fff;font:600 13px sans-serif;border-radius:8px';
    d.body.append(banner);
    return { checks };
  }

  if (caseName === 'xss') {
    const casePayload = '<img src=x onerror="window.__nativeSecurityXss=(window.__nativeSecurityXss||0)+1">';
    await wait('Timeline did not render the crafted fixture', () => d.querySelector('#clipLane [data-clip]'));
    check('Opening a project with crafted IDs runs no script marker', marker() === 0);
    check(
      'The marker detector itself still catches an injected handler',
      await (async () => {
        const control = d.createElement('div');
        control.innerHTML =
          '<img src=x onerror="window.__nativeSecurityControl=(window.__nativeSecurityControl||0)+1">';
        d.body.append(control);
        await wait('Positive XSS control did not execute', () => w.__nativeSecurityControl === 1, 5000);
        control.remove();
        return true;
      })(),
    );
    const clipNode = [...d.querySelectorAll('#clipLane [data-clip]')].find(node => node.dataset.clip === casePayload);
    check('A crafted clip ID is a data attribute value, not a new element', !!clipNode);
    check(
      'The crafted take number renders as text inside the clip meta',
      clipNode.querySelector('.clip-meta span')?.textContent.includes(casePayload),
    );
    check(
      'Crafted clip fields inserted no event-handler image',
      clipNode.querySelectorAll('img[src="x"]').length === 0 && d.querySelectorAll('#editor [onerror]').length === 0,
    );
    n.selectClip(casePayload);
    await wait(
      'Inspector did not render the crafted take',
      () => $('takeList').querySelectorAll('[data-view]').length > 0,
    );
    const clip = n.state.clips.find(value => value.id === casePayload),
      take = clip.takes[0],
      takeCard = [...$('takeList').querySelectorAll('[data-view]')]
        .find(node => node.dataset.view === take.id)
        ?.closest('.take-card');
    check('A crafted take ID is a data attribute value', !!takeCard && takeCard.dataset.take === take.id);
    check('The crafted take number renders as text on the take card', takeCard.textContent.includes(casePayload));
    const mediaCard = [...d.querySelectorAll('#mediaPanel [data-media]')].find(
      node => node.dataset.media === take.media.id,
    );
    check('A crafted media ID is a data attribute value', !!mediaCard);
    check('A crafted media name renders as text in the media pool', mediaCard.textContent.includes(casePayload));
    check(
      'No crafted identity field executed the script marker after inspector and media rendering',
      marker() === 0 && d.querySelectorAll('#editor img[src="x"]').length === 0,
    );
    return { checks };
  }

  if (caseName === 'track') {
    await wait('Timeline did not render the crafted track fixture', () => d.querySelector('#clipLane [data-clip]'));
    const cut = d.querySelector('#clipLane .cut-transition'),
      injected = d.querySelectorAll('#editor img[src="x"]');
    if (marker() !== 0 || injected.length) {
      throw Error(
        'Crafted track number executed the script marker · marker=' +
          marker() +
          ' · injected=' +
          injected.length +
          ' · html=' +
          (injected[0]?.outerHTML || 'none') +
          ' · cut=' +
          (cut?.getAttribute('style') || 'missing'),
      );
    }
    check('A crafted track number does not execute the script marker', marker() === 0);
    check('Two touching shots on the crafted track produce a cut marker', !!cut);
    check(
      'The crafted track number stays inside the cut style attribute as text',
      cut.getAttribute('style').includes('__nativeSecurityXss') && cut.querySelectorAll('img').length === 0,
    );
    check('The crafted track number inserted no image element', injected.length === 0);
    return { checks };
  }

  if (caseName === 'media-before') {
    const imageNode = d.querySelector('#clipLane [data-clip="native-encoded-image"] .filmstrip img');
    await wait('Timeline did not request the before-fix image', () => imageNode);
    await wait('The before-fix image request did not settle', () => imageNode.complete, 15000);
    check(
      'The isolated before-fix url() leaves a raw # in the media address',
      imageNode.getAttribute('src').includes('#'),
    );
    check('The raw # truncates the project image address and the image does not decode', imageNode.naturalWidth === 0);
    const banner = d.createElement('div');
    banner.id = 'nativeSecurityMediaBeforeBanner';
    banner.textContent = 'F-18 before the fix: raw # in the media address truncated the request';
    banner.style.cssText =
      'position:fixed;left:24px;bottom:24px;z-index:2147483647;padding:12px 16px;background:#b91c1c;color:#fff;font:600 13px sans-serif;border-radius:8px';
    d.body.append(banner);
    return { checks };
  }

  if (caseName === 'media') {
    const image = n.state.clips.find(clip => clip.id === 'native-encoded-image').takes[0].media,
      video = n.state.clips.find(clip => clip.id === 'native-encoded-video').takes[0].media,
      imageNode = d.querySelector('#clipLane [data-clip="native-encoded-image"] .filmstrip img');
    await wait('Timeline did not request the encoded image', () => imageNode);
    await wait('The encoded image did not decode', () => imageNode.complete && imageNode.naturalWidth > 0, 20000);
    check(
      'A real # and literal %41 in a project image name load through the encoded media URL',
      imageNode.src === absoluteMediaUrl(image.poster) &&
        imageNode.src.includes('%23') &&
        imageNode.src.includes('%2541') &&
        imageNode.naturalWidth === 64,
    );
    check(
      'The encoded image URL keeps the literal percent-encoded 41 instead of an A',
      !imageNode.src.includes('%41%') && imageNode.src.includes('100%25'),
    );

    const videoElement = d.createElement('video');
    videoElement.preload = 'auto';
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.src = absoluteMediaUrl(video.originalFile);
    d.body.append(videoElement);
    await wait(
      'The encoded project video did not load',
      () => videoElement.readyState >= 2 && videoElement.videoWidth === 320,
      30000,
    );
    check(
      'A real # and literal %41 in a project video name load through the encoded media URL',
      videoElement.src === absoluteMediaUrl(video.originalFile) &&
        videoElement.src.includes('%23') &&
        videoElement.src.includes('%2541'),
    );
    check(
      'The encoded video decodes its real dimensions',
      videoElement.videoWidth === 320 && videoElement.videoHeight === 180 && Math.abs(videoElement.duration - 2) < 0.1,
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('The encoded video did not seek')), 15000);
      videoElement.addEventListener(
        'seeked',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      videoElement.currentTime = 1.25;
    });
    await wait(
      'The encoded video seek did not settle',
      () => !videoElement.seeking && Math.abs(videoElement.currentTime - 1.25) < 0.12,
      10000,
    );
    check('The encoded video seeks inside the real project file', Math.abs(videoElement.currentTime - 1.25) < 0.12);
    videoElement.remove();

    const range = await fetch(mediaUrl(video.file), { headers: { Range: 'bytes=0-63' } }),
      rangeBytes = new Uint8Array(await range.arrayBuffer());
    check(
      'The host range route serves the generated video with # and %41',
      range.status === 206 &&
        /^bytes 0-63\/\d+$/.test(range.headers.get('Content-Range') || '') &&
        rangeBytes.length === 64 &&
        String.fromCharCode(...rangeBytes.slice(4, 8)) === 'ftyp',
    );
    const originalRange = await fetch(mediaUrl(video.originalFile), { headers: { Range: 'bytes=0-63' } });
    check(
      'The host range route also serves the original project input name',
      originalRange.status === 206 && originalRange.headers.get('Content-Range')?.startsWith('bytes 0-63/'),
    );
    const queryRange = await fetch(mediaUrl(video.file) + '?native-security=query', {
      headers: { Range: 'bytes=0-63' },
    });
    check(
      'A URI query after the encoded file name is not part of the real name',
      queryRange.status === 206 && queryRange.headers.get('Content-Range')?.startsWith('bytes 0-63/'),
    );
    const imageResponse = await fetch(mediaUrl(image.poster));
    check(
      'The host serves the project image whose name holds # and literal %41',
      imageResponse.status === 200 && (await imageResponse.arrayBuffer()).byteLength > 100,
    );
    const doubleDecoded = await fetch(mediaUrl(video.file).replace('%2541', '%41'));
    check('The host does not double-decode a literal %41 in a project name', doubleDecoded.status >= 400);
    return { checks };
  }

  if (caseName === 'export') {
    const created = [],
      revoked = [],
      events = [],
      originalCreate = URL.createObjectURL,
      originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = value => {
      const url = originalCreate.call(URL, value);
      created.push(url);
      events.push({ type: 'create', url });
      return url;
    };
    URL.revokeObjectURL = url => {
      revoked.push(url);
      events.push({ type: 'revoke', url });
      return originalRevoke.call(URL, url);
    };
    const link = () => $('exportResult').querySelector('a.download-link'),
      openExport = async () => {
        $('export').click();
        await wait('The export dialog did not open', () => $('exportFormat') && $('renderExport'));
        $('exportFormat').value = 'otio';
        $('exportFormat').dispatchEvent(new Event('change'));
        await wait('The timeline export button did not enable', () => !$('renderExport').disabled);
      },
      exportOnce = async previous => {
        $('renderExport').click();
        await wait(
          previous ? 'The replacement timeline export did not finish' : 'The timeline export did not finish',
          () => link() && link().href !== previous,
          30000,
        );
        return link().href;
      };
    await openExport();
    const first = await exportOnce(null),
      firstCreated = events.findIndex(event => event.type === 'create' && event.url === first);
    check('The first timeline export creates a blob download URL', first.startsWith('blob:') && firstCreated >= 0);
    $('exportCancel').click();
    await wait('The first export dialog did not close', () => $('modalOverlay').hidden);
    await openExport();
    const second = await exportOnce(first),
      secondCreated = events.findIndex(
        (event, index) => index > firstCreated && event.type === 'create' && event.url === second,
      ),
      revokedFirst = events.findIndex(event => event.type === 'revoke' && event.url === first);
    check('The second timeline export replaces the download link', second !== first && secondCreated > firstCreated);
    check(
      'The previous timeline blob URL is revoked before the replacement is created',
      revokedFirst > firstCreated && revokedFirst < secondCreated,
    );
    check('The current timeline blob URL is still live', !revoked.includes(second));
    const firstStillResolves = await fetch(first).then(
      () => true,
      () => false,
    );
    check('The revoked timeline blob URL no longer resolves', !firstStillResolves);
    const downloaded = await fetch(second);
    check(
      'The current timeline blob URL contains the exported OTIO timeline',
      downloaded.ok && JSON.parse(await downloaded.text()).tracks,
    );
    check('Each timeline export creates exactly one new blob URL', created.length === 2);
    return { checks };
  }

  throw Error('Unknown native security case: ' + caseName);
})();
