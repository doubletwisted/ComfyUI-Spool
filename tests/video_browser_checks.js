// T3 preview_evaluate on the full native synthetic-video project. Expected PNGs
// must be ffmpeg-decoded frames 4/5/6 from this exact review proxy, under assets/.
(async () => {
  const n = spoolNative,
    v = document.querySelector('video.front');
  if (!v || v.readyState < 2) throw Error('Load the native synthetic-video project first');
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true }),
    expected = {};
  for (const f of [4, 5, 6]) {
    const image = await createImageBitmap(
      await (await fetch('/spool/media/assets/expected-frame-' + f + '.png')).blob(),
    );
    context.drawImage(image, 0, 0);
    image.close();
    expected[f] = context.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  const checks = [],
    frames = [];
  window.videoQAProgress = { checks, frames };
  const decode = async (frame, action) => {
    const recoveryBefore = n.videoSeek?.recoveries || 0;
    let callback = null;
    const callbackId = v.requestVideoFrameCallback(
      (now, metadata) => (callback = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames }),
    );
    if (Math.abs(v.currentTime - (frame + 0.5) / 24) > 0.00001)
      await new Promise((resolve, reject) => {
        const done = () => {
            clearTimeout(timer);
            resolve();
          },
          timer = setTimeout(() => {
            v.removeEventListener('seeked', done);
            reject(Error('Paused seek timeout'));
          }, 5000);
        v.addEventListener('seeked', done, { once: true });
        action();
      });
    else action();
    const deadline = Date.now() + 12000;
    while (n.videoSeek?.pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (n.videoSeek?.pending) throw Error('Native decoder recovery did not settle');
    context.drawImage(v, 0, 0);
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const errors = Object.fromEntries(
      [4, 5, 6].map(f => {
        let sum = 0;
        for (let i = 0; i < actual.length; i += 4)
          for (let channel = 0; channel < 3; channel++) sum += Math.abs(actual[i + channel] - expected[f][i + channel]);
        return [f, sum / (canvas.width * canvas.height * 3)];
      }),
    );
    const nearest = Number(Object.entries(errors).sort((a, b) => a[1] - b[1])[0][0]);
    if (!v.paused || nearest !== frame || errors[frame] > 2)
      throw Error(
        'Decoded paused pixels differ from independently decoded proxy frame ' + frame + ': ' + JSON.stringify(errors),
      );
    let initialRecoveryCallback = null;
    const recovered = (n.videoSeek?.recoveries || 0) > recoveryBefore;
    if (callback && Math.abs(callback.mediaTime - frame / 24) > 0.00001) {
      if (!recovered) throw Error('Presented media timestamp differs from selected proxy frame');
      initialRecoveryCallback = callback;
      callback = null;
    }
    if (callback && frames.at(-1)?.callback && callback.presentedFrames <= frames.at(-1).callback.presentedFrames)
      throw Error('Presented-frame count did not advance');
    if (!callback) v.cancelVideoFrameCallback(callbackId);
    frames.push({ frame, currentTime: v.currentTime, nearest, errors, callback, initialRecoveryCallback, recovered });
  };
  await decode(5, () => n.setFrame(5, true));
  await decode(6, () => document.getElementById('frameForward').click());
  await decode(5, () => document.getElementById('frameBack').click());
  await decode(4, () => document.getElementById('frameBack').click());
  checks.push('Paused seek/forward/back present distinct proxy pixels matching ffmpeg frames5/6/5/4');
  const clip = n.state.clips.find(c => c.id === n.view.selected),
    media = clip?.takes.find(t => t.id === clip.takeId)?.media;
  if (media?.fps !== '30/1' || !media.audio || media.sequenceFps !== 24)
    throw Error('Selected native take metadata does not retain original30fps/audio and24fps review policy');
  checks.push('Original fps30/1/audio retained; frame controls operate on24fps review proxy');
  if (frames.every(f => f.callback)) checks.push('Paused requestVideoFrameCallback confirms all four media timestamps');
  return { checks, frames, pausedCallbacks: frames.filter(f => f.callback).length, project: n.projectKey };
})();
