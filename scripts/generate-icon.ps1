# Regenerates assets/icon.ico from the icon design (see assets/icon.svg).
# Pure .NET/GDI+ — no ImageMagick or other tooling required.
# Run from anywhere:  npm run icon
#
# The .ico is the source of truth for the Electron window/taskbar icon and the
# Desktop shortcut; the matching assets/icon.svg is the in-app favicon.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $root 'assets\icon.ico'

# App palette (kept in sync with styles.css / assets/icon.svg).
$paperTop = [System.Drawing.Color]::FromArgb(247, 240, 222)  # #f7f0de
$paperBot = [System.Drawing.Color]::FromArgb(239, 230, 207)  # #efe6cf
$edge     = [System.Drawing.Color]::FromArgb(217, 205, 176)  # #d9cdb0
$ink      = [System.Drawing.Color]::FromArgb(51, 48, 43)     # #33302b
$oxblood  = [System.Drawing.Color]::FromArgb(122, 59, 46)    # #7a3b2e

# Pick the most book-like serif that is actually installed.
function Get-SerifFamily {
  $prefer = @('EB Garamond', 'Palatino Linotype', 'Book Antiqua', 'Georgia', 'Times New Roman')
  $installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  foreach ($name in $prefer) { if ($installed -contains $name) { return $name } }
  return [System.Drawing.FontFamily]::GenericSerif.Name
}
$serif = Get-SerifFamily

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x,           $y,           $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y,           $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90)
  $p.AddArc($x,           $y + $h - $d, $d, $d,  90, 90)
  $p.CloseFigure()
  return $p
}

# Render the icon design at a given pixel size (supersampled 4x for crisp edges).
function New-IconBitmap([int]$size) {
  $ss  = 4
  $S   = $size * $ss
  $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  # Geometry proportional to a 256-unit design, scaled to $S.
  $k = $S / 256.0
  $tile = New-RoundedPath (8 * $k) (8 * $k) (240 * $k) (240 * $k) (44 * $k)

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $S)), $paperTop, $paperBot)
  $g.FillPath($brush, $tile)
  $brush.Dispose()

  $pen = New-Object System.Drawing.Pen($edge, (3 * $k))
  $g.DrawPath($pen, $tile)
  $pen.Dispose()

  # Manuscript baseline rule.
  $rule = New-RoundedPath (70 * $k) (178 * $k) (116 * $k) (6 * $k) (3 * $k)
  $ruleBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(217, $oxblood.R, $oxblood.G, $oxblood.B))
  $g.FillPath($ruleBrush, $rule)
  $ruleBrush.Dispose()
  $rule.Dispose()

  # Serif "M" monogram, centered above the rule.
  $font = New-Object System.Drawing.Font($serif, (176 * $k),
    [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt  = New-Object System.Drawing.StringFormat
  $fmt.Alignment     = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $inkBrush = New-Object System.Drawing.SolidBrush($ink)
  $box = New-Object System.Drawing.RectangleF(0, (2 * $k), $S, (172 * $k))
  $g.DrawString('M', $font, $inkBrush, $box, $fmt)
  $inkBrush.Dispose()
  $font.Dispose()

  $g.Dispose()
  $tile.Dispose()

  if ($ss -eq 1) { return $bmp }
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $go  = [System.Drawing.Graphics]::FromImage($out)
  $go.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $go.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $go.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $go.Dispose()
  $bmp.Dispose()
  return $out
}

# Encode each size as PNG and pack them into a single .ico (PNG-compressed
# entries, supported by Windows Vista and later — and by Electron).
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs  = @()
foreach ($s in $sizes) {
  $bmp = New-IconBitmap $s
  $ms  = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngs += ,@{ size = $s; bytes = $ms.ToArray() }
  $ms.Dispose()
}

$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type: icon
$bw.Write([UInt16]$pngs.Count)       # image count

# Directory entries follow the header; image data follows all entries.
$offset = 6 + 16 * $pngs.Count
foreach ($p in $pngs) {
  $dim = if ($p.size -ge 256) { 0 } else { $p.size }
  $bw.Write([Byte]$dim)              # width  (0 == 256)
  $bw.Write([Byte]$dim)              # height (0 == 256)
  $bw.Write([Byte]0)                 # palette
  $bw.Write([Byte]0)                 # reserved
  $bw.Write([UInt16]1)               # color planes
  $bw.Write([UInt16]32)              # bits per pixel
  $bw.Write([UInt32]$p.bytes.Length) # data size
  $bw.Write([UInt32]$offset)         # data offset
  $offset += $p.bytes.Length
}
foreach ($p in $pngs) { $bw.Write($p.bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Host "Wrote $icoPath ($($pngs.Count) sizes, serif: $serif)"
