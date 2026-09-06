# Cuts raw generated character sheets into the even sprite strips the room loads.
#
#   pwsh scripts/cut-cast.ps1 -Sheet 1=../cast1.4.png -Sheet 2=../cast2.4.png
#   pwsh scripts/cut-cast.ps1 -All ../1.3.png,../2.3.png,../3.3.png,../4.3.png,../5.3.png
#
# ⚠ WINDOWS ONLY, and deliberately outside the product. It uses System.Drawing,
# it runs by hand when new art arrives, and nothing that ships imports it — the
# three-OS rule governs the app, not the studio. It lives in the repository
# because `web/src/office/art/manifest.ts` names it as the contract that decides
# the cell geometry, and a contract with a script that exists only in somebody's
# temp folder is a contract nobody can honour.
#
# ── THREE THINGS MUST BE NORMALISED, AND NONE FOLLOWS FROM ANOTHER ────────────
#
#  1. STANDING HEIGHT. Measured 658..711 px across the five v3 sheets — an 8%
#     spread. Unnormalised, character 2 is visibly shorter than character 3 on
#     screen, and every number derived from CH_H (shadow width, seat height, the
#     spacing of ring slots) is silently wrong for that one person.
#  2. THE GROUND LINE. The base of the figure measured 708..744 between sheets.
#     Anchoring each CELL to its own base throws away the heel lift the artist
#     drew on purpose; anchoring the whole SHEET to one ground line keeps it.
#  3. THE HORIZONTAL ANCHOR — and it is NOT the bounding box. In a walk frame the
#     box stretches around the extended leg, so a box-centred cell slides the
#     torso sideways every stride. The anchor is the centroid of the HIP band
#     (40%..55% of figure height), which is the part that does not travel
#     within a stride.
#
# ⚠ ONE SCALE FACTOR PER SHEET, taken from the STANDING cell. Scaling each cell
# to its own height would flatten exactly the pose differences the sit frame is
# supposed to have — it is shorter because the person is sitting down.
param(
  [string[]] $Sheet = @(),
  [string[]] $All = @()
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OUT = Join-Path $PSScriptRoot '..\web\src\office\art\cast'

# Target geometry. Chosen from measurements, not by eye:
#   BODY_H 690 - near the top of the measured range, so no sheet is upscaled >5%.
#   CELL.h 720 - the tallest frame after scaling is 697, leaving 23 px of headroom.
#   CELL.w 480 - the widest is 418, keeping the 6% side margin the sheets were
#                authored with.
# ⚠ These three numbers are also written in `art/manifest.ts`. They are the same
# fact stated twice, which is a drift waiting to happen — the manifest is the one
# the app reads, so if these ever change, change it there in the same commit.
$BODY_H = 690
$CELL_W = 480
$CELL_H = 720

$jobs = @()
foreach ($s in $Sheet) {
  $i, $p = $s -split '=', 2
  $jobs += [pscustomobject]@{ idx = [int]$i; path = $p }
}
for ($i = 0; $i -lt $All.Count; $i++) { $jobs += [pscustomobject]@{ idx = $i; path = $All[$i] } }
if (-not $jobs) { throw 'nothing to cut: pass -Sheet <index>=<file> or -All <file,file,...>' }

function Load($p) {
  $bm = [System.Drawing.Bitmap]::new($p); $w = $bm.Width; $h = $bm.Height
  $dt = $bm.LockBits([System.Drawing.Rectangle]::new(0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $st = $dt.Stride; $buf = [byte[]]::new($st * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($dt.Scan0, $buf, 0, $buf.Length)
  $bm.UnlockBits($dt); $bm.Dispose(); return @{ w = $w; h = $h; st = $st; buf = $buf }
}

# Columns that carry any opaque pixel, grouped into runs. A run is one cell —
# unless two figures touch, which is what the waist cut below is for.
function Runs($col, $minw) {
  $r = New-Object System.Collections.ArrayList; $s = -1
  for ($x = 0; $x -lt $col.Length; $x++) {
    if ($col[$x] -gt 0 -and $s -lt 0) { $s = $x }
    elseif ($col[$x] -eq 0 -and $s -ge 0) { if (($x - $s) -ge $minw) { [void]$r.Add([pscustomobject]@{ a = $s; b = $x - 1 }) }; $s = -1 }
  }
  if ($s -ge 0) { [void]$r.Add([pscustomobject]@{ a = $s; b = $col.Length - 1 }) }
  return $r
}

$report = New-Object System.Collections.ArrayList
foreach ($job in $jobs) {
  # ⚠ `.Path`, not the `PathInfo` object. `System.Drawing.Bitmap` takes a string
  # and the cast failure it throws names the file, so it reads like a bad PNG.
  $found = Resolve-Path (Join-Path $PSScriptRoot $job.path) -ErrorAction SilentlyContinue
  if (-not $found) { $found = Resolve-Path $job.path }
  $src = $found.Path
  $im = Load $src

  $col = [int[]]::new($im.w)
  for ($y = 0; $y -lt $im.h; $y++) { $ro = $y * $im.st; for ($x = 0; $x -lt $im.w; $x++) { if ($im.buf[$ro + $x * 4 + 3] -gt 40) { $col[$x]++ } } }
  $cells = @(Runs $col 12)
  # Two figures drawn touching come back as ONE run. Cut the widest run at its
  # emptiest column — the prompt's SEPARATION line exists so this is rare, but
  # it still happens and a sheet that segments into five is not usable.
  while ($cells.Count -lt 6) {
    $wid = $cells | Sort-Object { $_.b - $_.a } -Descending | Select-Object -First 1
    $best = -1; $bv = [int]::MaxValue
    for ($x = ($wid.a + 150); $x -le ($wid.b - 150); $x++) { if ($col[$x] -lt $bv) { $bv = $col[$x]; $best = $x } }
    if ($best -lt 0) { throw "$($job.path): cannot split a run of $($wid.b - $wid.a + 1) px" }
    $nl = New-Object System.Collections.ArrayList
    foreach ($c in $cells) {
      if ($c -eq $wid) { [void]$nl.Add([pscustomobject]@{ a = $c.a; b = $best - 1 }); [void]$nl.Add([pscustomobject]@{ a = $best; b = $c.b }) }
      else { [void]$nl.Add($c) }
    }
    $cells = @($nl | Sort-Object a)
  }
  if ($cells.Count -ne 6) { throw "$($job.path): segmented into $($cells.Count) cells, must be 6" }

  $figs = @()
  foreach ($c in $cells) {
    $ymin = 99999; $ymax = -1; $xmin = 99999; $xmax = -1
    for ($y = 0; $y -lt $im.h; $y++) {
      $ro = $y * $im.st
      for ($x = $c.a; $x -le $c.b; $x++) {
        if ($im.buf[$ro + $x * 4 + 3] -gt 40) {
          if ($y -lt $ymin) { $ymin = $y }; if ($y -gt $ymax) { $ymax = $y }
          if ($x -lt $xmin) { $xmin = $x }; if ($x -gt $xmax) { $xmax = $x }
        }
      }
    }
    $fh = $ymax - $ymin + 1
    $y0 = [int]($ymin + $fh * 0.40); $y1 = [int]($ymin + $fh * 0.55)
    $sum = 0.0; $cnt = 0
    for ($y = $y0; $y -le $y1; $y++) {
      $ro = $y * $im.st
      for ($x = $c.a; $x -le $c.b; $x++) { if ($im.buf[$ro + $x * 4 + 3] -gt 40) { $sum += $x; $cnt++ } }
    }
    $anchor = if ($cnt -gt 0) { $sum / $cnt } else { ($xmin + $xmax) / 2.0 }
    $figs += [pscustomobject]@{ a = $c.a; b = $c.b; xmin = $xmin; xmax = $xmax; ymin = $ymin; ymax = $ymax; h = $fh; anchor = $anchor }
  }

  $stand = $figs[0]
  $sit = $figs[5]
  $k = $BODY_H / [double]$stand.h
  $ground = ($figs | Measure-Object -Property ymax -Maximum).Maximum

  $bmp = [System.Drawing.Bitmap]::new("$src")
  $dst = [System.Drawing.Bitmap]::new(($CELL_W * 6), $CELL_H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.CompositingMode = 'SourceOver'
  $g.CompositingQuality = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.SmoothingMode = 'HighQuality'

  $maxW = 0; $maxH = 0
  for ($i = 0; $i -lt 6; $i++) {
    $fg = $figs[$i]
    $sw = $fg.b - $fg.a + 1
    $g.DrawImage($bmp,
      [System.Drawing.RectangleF]::new((($i * $CELL_W) + $CELL_W / 2.0 - ($fg.anchor - $fg.a) * $k), ($CELL_H - $ground * $k), ($sw * $k), ($im.h * $k)),
      [System.Drawing.RectangleF]::new($fg.a, 0, $sw, $im.h),
      [System.Drawing.GraphicsUnit]::Pixel)
    $fw = [int](($fg.xmax - $fg.xmin + 1) * $k); $fhh = [int]($fg.h * $k)
    if ($fw -gt $maxW) { $maxW = $fw }; if ($fhh -gt $maxH) { $maxH = $fhh }
  }
  $g.Dispose(); $bmp.Dispose()

  $path = Join-Path $OUT "cast-$($job.idx).png"
  $dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()

  [void]$report.Add([pscustomobject]@{
      source = Split-Path $src -Leaf
      wrote  = "cast-$($job.idx).png"
      k      = [math]::Round($k, 4)
      standPx = $stand.h
      # ⚠ REPORTED BECAUSE THE MANIFEST STORES IT. `CastSprite.sitH` is this
      # number after scaling, and the seated lift is derived from it — a re-cut
      # that does not update the manifest leaves a seated figure floating.
      sitH   = [int]($sit.h * $k)
      widest = $maxW
      tallest = $maxH
      kb     = [math]::Round((Get-Item $path).Length / 1KB)
    })
}
$report | Format-Table -AutoSize
"CELL = { w: $CELL_W, h: $CELL_H }   BODY_H = $BODY_H"
"-> copy every sitH into SPRITES in web/src/office/art/manifest.ts"
