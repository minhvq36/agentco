# Derives the RECOLOURABLE GARMENT mask for each cast strip, and renders a
# review page so the result is looked at rather than assumed.
#
#   powershell -File scripts/cast-mask.ps1
#
# ⚠ WINDOWS ONLY and outside the product, same standing as `cut-cast.ps1`.
#
# ── THE RULES ARE MEASUREMENTS, NOT GUESSES ──────────────────────────────────
#
# Every window below came out of `scripts/cast-colours.ps1` run on the SHIPPED
# strip. → docs/SPEC-office-art.md §11
#
# ⚠ THERE ARE THREE SEPARATORS, NOT ONE, AND PICKING THE WRONG FAMILY LOOKS
# EXACTLY LIKE "this character cannot be tinted". All three are in use here:
#
#   HUE          c0 · c2 · c4  the shirt is blue, everything else is not
#   LIGHTNESS    c3            waistcoat lum 107, trousers lum 57, both neutral
#   TEMPERATURE  c1            jacket COOL (B >= R-2), trousers WARM (B = R-16),
#                              and they are within 3 luminance points of each other
#
# ⚠ c1 WAS DECLARED IMPOSSIBLE ONCE, ON 07/09, AFTER ONLY THE LIGHTNESS FAMILY
# WAS TRIED. Its three dark regions sit at lum 57 / 54 / 60 — one band, so no
# lightness window works, and that was reported as "no window exists". It was the
# wrong conclusion from a real measurement: the jacket and the trousers differ by
# 16 points of `B - R`. Measuring N failures proves a MECHANISM, never a
# CONCLUSION — before calling a road dead, ask what the equivalent thing that
# already works does differently.
#
# ⚠ AND A GEOMETRIC RULE IS ALWAYS WRONG. §11 already paid for this: "only tint
# above the waistline" cut the hem off the jacket in every pose, because the
# poses are exactly where the geometry moves.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# ⚠ THE MASKS ARE SHIPPED ART and live beside the strips they belong to. Only the
# REVIEW PAGE goes to a temp folder — it is a thing to look at once, not an asset.
# A mask kept in somebody's temp directory is a mask the next re-cut cannot find.
$ART = Join-Path $PSScriptRoot '..\web\src\office\art\cast'
$OUT = Join-Path $env:TEMP 'agentco-mask'
if (-not (Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT | Out-Null }

# blue = the shirt, and the trousers on every sheet are brown or neutral, so
# `B - R` alone separates them. The lower bound of 26 rather than 40 is what
# keeps the DARKEST FOLD of c0's shirt (#233143, B-R 32) inside the garment —
# a mask that drops the folds leaves an untinted seam down the middle of it.
$rules = @{
  0 = @{ what = 'shirt, mid blue'; test = { param($r, $g, $b, $lum, $sat) ($b - $r) -gt 26 -and $sat -ge 0.32 -and $lum -ge 40 -and $lum -le 170 } }
  # TEMPERATURE, not lightness. `B >= R - 2` is "not warm": the hair and the
  # trousers are brown-ish (R above B) and drop out, the inner tee is too light,
  # the shoes are too dark. What is left is the jacket.
  1 = @{ what = 'outer jacket, cool grey'; test = { param($r, $g, $b, $lum, $sat) $b -ge ($r - 2) -and $lum -gt 38 -and $lum -lt 118 } }
  2 = @{ what = 'shirt, mid blue'; test = { param($r, $g, $b, $lum, $sat) ($b - $r) -gt 26 -and $sat -ge 0.32 -and $lum -ge 40 -and $lum -le 170 } }
  3 = @{ what = 'waistcoat, neutral grey'; test = { param($r, $g, $b, $lum, $sat) $sat -le 0.10 -and $lum -ge 88 -and $lum -le 135 } }
  4 = @{ what = 'shirt, light blue'; test = { param($r, $g, $b, $lum, $sat) ($b - $r) -gt 40 -and $sat -ge 0.28 -and $lum -ge 130 -and $lum -le 230 } }
}

$tints = @('#b4532a', '#3f7d4a', '#8a5a9b', '#c08a2e', '#2f6f6a')
$rows = ''
$report = New-Object System.Collections.ArrayList

foreach ($i in 0..4) {
  $src = Join-Path $ART "cast-$i.png"
  $bmp = [System.Drawing.Bitmap]::new($src)
  $w = $bmp.Width; $h = $bmp.Height

  if (-not $rules.ContainsKey($i)) {
    [void]$report.Add([pscustomobject]@{ cast = "cast-$i"; region = 'NONE - one lightness band'; px = 0; pct = 0 })
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($src))
    $rows += "<div class='lbl'>cast-$i &mdash; NO TINTABLE GARMENT (jacket, trousers and lining all at one lightness)</div><div class='row'><figure><div class='stack' style='--w:${w}px;--h:${h}px'><span class='sprite' style=`"background-image:url('data:image/png;base64,$b64')`"></span></div><figcaption>original</figcaption></figure></div>"
    $bmp.Dispose()
    continue
  }

  $dt = $bmp.LockBits([System.Drawing.Rectangle]::new(0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $st = $dt.Stride; $buf = [byte[]]::new($st * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($dt.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($dt)

  $mask = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $md = $mask.LockBits([System.Drawing.Rectangle]::new(0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $mb = [byte[]]::new($md.Stride * $h)
  $n = 0
  for ($y = 0; $y -lt $h; $y++) {
    $ro = $y * $st
    for ($x = 0; $x -lt $w; $x++) {
      $o = $ro + $x * 4
      if ($buf[$o + 3] -lt 40) { continue }
      $b = $buf[$o]; $g = $buf[$o + 1]; $r = $buf[$o + 2]
      $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b
      $mx = [Math]::Max($r, [Math]::Max($g, $b)); $mn = [Math]::Min($r, [Math]::Min($g, $b))
      $sat = if ($mx -eq 0) { 0 } else { ($mx - $mn) / $mx }
      if (& $rules[$i].test $r $g $b $lum $sat) {
        $mo = $y * $md.Stride + $x * 4
        $mb[$mo] = 255; $mb[$mo + 1] = 255; $mb[$mo + 2] = 255; $mb[$mo + 3] = $buf[$o + 3]
        $n++
      }
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($mb, 0, $md.Scan0, $mb.Length)
  $mask.UnlockBits($md)
  $mpath = Join-Path $ART "cast-$i-mask.png"
  $mask.Save($mpath, [System.Drawing.Imaging.ImageFormat]::Png)
  $mask.Dispose(); $bmp.Dispose()

  [void]$report.Add([pscustomobject]@{ cast = "cast-$i"; region = $rules[$i].what; px = $n; pct = [Math]::Round(100 * $n / ($w * $h), 2) })

  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($src))
  $m64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($mpath))
  $cells = "<figure><div class='stack'><span class='sprite' style=`"background-image:url('data:image/png;base64,$b64')`"></span></div><figcaption>original</figcaption></figure>"
  $cells += "<figure><div class='stack mask'><span class='sprite' style=`"background-image:url('data:image/png;base64,$m64')`"></span></div><figcaption>the mask</figcaption></figure>"
  foreach ($t in $tints) {
    $cells += "<figure><div class='stack'><span class='sprite' style=`"background-image:url('data:image/png;base64,$b64')`"></span><span class='tint' style=`"background:$t;-webkit-mask-image:url('data:image/png;base64,$m64');mask-image:url('data:image/png;base64,$m64')`"></span></div><figcaption>$t</figcaption></figure>"
  }
  $rows += "<div class='lbl'>cast-$i &mdash; $($rules[$i].what) &mdash; $n px</div><div class='row'>$cells</div>"
}

$report | Format-Table -AutoSize

# ⚠ The strip is 2880 x 720 and only the STANDING cell is shown: the review size
# that matters is the shipping size (§0), and six cells side by side is none of
# the two sizes anybody ever sees.
$html = @"
<!doctype html><meta charset=utf-8>
<style>
 body{margin:0;background:#f2efe6;font:13px system-ui;color:#232019;padding:18px}
 h2{font-size:16px;margin:0 0 4px} p{margin:0 0 14px;color:#7d766a;font-size:12px}
 .lbl{margin:16px 0 6px;font-weight:600;font-size:12px;color:#7d766a}
 .row{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}
 figure{margin:0;text-align:center}
 figcaption{margin-top:5px;color:#7d766a;font-family:ui-monospace,monospace;font-size:10px}
 /* isolation: without it the blend reaches down into the page behind. */
 .stack{position:relative;width:133px;height:200px;isolation:isolate}
 .mask{background:#cfcac0}
 .sprite,.tint{position:absolute;inset:0;background-size:798px 200px;background-position:0 0;background-repeat:no-repeat}
 .tint{-webkit-mask-size:798px 200px;mask-size:798px 200px;-webkit-mask-position:0 0;mask-position:0 0;
       -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;mix-blend-mode:color}
</style>
<h2>Garment tint &mdash; masks derived by colour + lightness</h2>
<p>Standing cell at the shipping size (~133px wide). mix-blend-mode: color keeps the artwork's luminance, so folds survive.</p>
$rows
"@
$page = Join-Path $OUT 'tint-review.html'
[IO.File]::WriteAllText($page, $html, [Text.UTF8Encoding]::new($false))
"-> $page"
"-> masks in $OUT"
