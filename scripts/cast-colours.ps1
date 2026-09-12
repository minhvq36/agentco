# Reports what a cast strip is actually MADE OF, so a tint mask can be chosen
# from measurements instead of from a screenshot.
#
#   powershell -File scripts/cast-colours.ps1
#
# ⚠ WINDOWS ONLY, and deliberately outside the product — same standing as
# `cut-cast.ps1`: it runs by hand when new art arrives and nothing that ships
# imports it. The three-OS rule governs the app, not the studio.
#
# For every strip it prints, from the STANDING cell only:
#   · the twenty largest colour clusters, with luminance and saturation
#   · the height of the SIT cell's figure, because `art/manifest.ts` stores that
#     number and a re-cut that does not update it leaves a seated figure floating
#
# → docs/SPEC-office-art.md §11 (the tint) and §CastSprite.sitH
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ART = Join-Path $PSScriptRoot '..\web\src\office\art\cast'
$CELL_W = 480
$CELL_H = 720

function Load($p) {
  $bm = [System.Drawing.Bitmap]::new($p)
  $w = $bm.Width; $h = $bm.Height
  $dt = $bm.LockBits([System.Drawing.Rectangle]::new(0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $st = $dt.Stride; $buf = [byte[]]::new($st * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($dt.Scan0, $buf, 0, $buf.Length)
  $bm.UnlockBits($dt); $bm.Dispose()
  return @{ w = $w; h = $h; st = $st; buf = $buf }
}

foreach ($i in 0..4) {
  $path = Join-Path $ART "cast-$i.png"
  $im = Load $path

  # ── the standing cell, quantised to 16 levels per channel so folds of one
  # garment land in one bucket instead of forty.
  $tally = @{}
  for ($y = 0; $y -lt $CELL_H; $y++) {
    $ro = $y * $im.st
    for ($x = 0; $x -lt $CELL_W; $x++) {
      $o = $ro + $x * 4
      if ($im.buf[$o + 3] -lt 40) { continue }
      $b = $im.buf[$o]; $g = $im.buf[$o + 1]; $r = $im.buf[$o + 2]
      $key = "$([int]($r / 16))_$([int]($g / 16))_$([int]($b / 16))"
      if ($tally.ContainsKey($key)) { $tally[$key].n++ ; $tally[$key].r += $r; $tally[$key].g += $g; $tally[$key].b += $b }
      else { $tally[$key] = [pscustomobject]@{ n = 1; r = [double]$r; g = [double]$g; b = [double]$b } }
    }
  }

  "== cast-$i.png  ($($im.w)x$($im.h)) =="
  $rows = $tally.GetEnumerator() | Sort-Object { $_.Value.n } -Descending | Select-Object -First 20 | ForEach-Object {
    $v = $_.Value
    $r = [int]($v.r / $v.n); $g = [int]($v.g / $v.n); $b = [int]($v.b / $v.n)
    $lum = [int](0.299 * $r + 0.587 * $g + 0.114 * $b)
    $mx = [Math]::Max($r, [Math]::Max($g, $b)); $mn = [Math]::Min($r, [Math]::Min($g, $b))
    $sat = if ($mx -eq 0) { 0 } else { [Math]::Round(($mx - $mn) / $mx, 2) }
    [pscustomobject]@{ px = $v.n; hex = ('#{0:x2}{1:x2}{2:x2}' -f $r, $g, $b); R = $r; G = $g; B = $b; lum = $lum; sat = $sat; 'B-R' = $b - $r }
  }
  $rows | Format-Table -AutoSize

  # ── the sit cell's figure height, which `art/manifest.ts` stores as `sitH`.
  $x0 = 5 * $CELL_W; $x1 = 6 * $CELL_W - 1
  $ymin = 99999; $ymax = -1
  for ($y = 0; $y -lt $CELL_H; $y++) {
    $ro = $y * $im.st
    for ($x = $x0; $x -le $x1; $x++) {
      if ($im.buf[$ro + $x * 4 + 3] -gt 40) { if ($y -lt $ymin) { $ymin = $y }; if ($y -gt $ymax) { $ymax = $y }; break }
    }
  }
  $standTop = 99999; $standBot = -1
  for ($y = 0; $y -lt $CELL_H; $y++) {
    $ro = $y * $im.st
    for ($x = 0; $x -lt $CELL_W; $x++) {
      if ($im.buf[$ro + $x * 4 + 3] -gt 40) { if ($y -lt $standTop) { $standTop = $y }; if ($y -gt $standBot) { $standBot = $y }; break }
    }
  }
  "sitH = $($ymax - $ymin + 1)   standH = $($standBot - $standTop + 1)   sit/stand = $([Math]::Round(($ymax - $ymin + 1) / ($standBot - $standTop + 1), 3))"
  ''
}
