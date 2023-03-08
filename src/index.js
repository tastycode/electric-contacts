//import stateGeos from "./gz_2010_us_040_00_500k.json";
import "./styles.css";
import geojsonExtent from "@mapbox/geojson-extent";
var pdfjsLib = require("pdfjs-dist");
const toBBox = require("geojson-bounding-box");

// 5 contacts randomly around in arkansas
const contacts = [
  {
    name: "Joe Matthew",
    address: "2222 W Poplar, Arkansas",
    location: [35.482569, -92.022929] // First Electric
  },
  {
    name: "Chris Matthew",
    address: "1000 W Poplar, Arkansas",
    location: [34.195902, -91.958742] // C&L EC
  },
  {
    name: "Chris Matthew",
    address: "1000 W Poplar, Arkansas",
    location: [35.206652, -94.131441] // AR Valley EC
  }
];
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry.js");
document.getElementById("app").innerHTML = `
<h1>REC District Contact Filter</h1>
<div>
<p>
  <label for="pdfDocument">PDF Map</label><br/>
  <input type="file" name="pdfDocument" id="pdfDocument" accept="application/pdf, application/x-pdf"/>
</p>
<p>

  <label for="csvDocument">Contacts CSV</label><br/>
  <input type="file" name="contactDocument" id="contactDocument" accept="text/csv"/>

</p>
  <p>
  <input type="submit">

  </p>
  
  
  <canvas id="pdf-canvas"></canvas>
  <svg id="svg-context"></svg>
  <select id="state-list"></select>
</div>
`;

var stateGeos = { features: [] };
var states = [];
(async () => {
  stateGeos = await (
    await fetch(
      "https://uploads.codesandbox.io/uploads/user/08efd83b-7032-4e4f-a63c-f22884438c67/vThS-gz_2010_us_040_00_500k.json"
    )
  ).json();
  let stateOptions = "";
  states = stateGeos.features.map((f) => f.properties.NAME).sort();
  for (const state of states) {
    stateOptions += `<option>${state}</option>`;
  }
  document.querySelector("#state-list").innerHTML = stateOptions;
})();

const readAsBytes = (inputNode) => {
  var reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = function () {
      const arrayBuffer = reader.result;
      const array = new Uint8Array(arrayBuffer);
      resolve(array);
      //binaryString = String.fromCharCode.apply(null, array);
    };
    reader.readAsArrayBuffer(inputNode.files[0]);
  });
};

class SVGGraphicsOverride extends pdfjsLib.SVGGraphics {
  constructor(commonObjs, objs) {
    super(commonObjs, objs);
    this._currentSvgText = "";
  }
  showText = (glyphs) => {
    for (const glyph of glyphs) {
      if (glyph && glyph.unicode !== undefined)
        this._currentSvgText += glyph.unicode;
    }
    super.showText(glyphs);
  };
  endText = () => {
    super.endText();
    const svgText = this._currentSvgText;
    this._currentSvgText = "";
    this.current.txtElement.setAttribute("aria-label", svgText);
  };
}
document
  .querySelector("input[type=file]")
  .addEventListener("change", async (e) => {
    const filename = e.target.files[0].name;
    console.log(e.target.files[0].name);
    const candidateState = states.find((state) => filename.includes(state));
    if (candidateState) {
      document.querySelector("select").value = candidateState;
    }
  });
document
  .querySelector("input[type=submit]")
  .addEventListener("click", async () => {
    const pdfBytes = await readAsBytes(document.querySelector("#pdfDocument"));

    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const pdf = await new Promise((resolve, reject) => {
      loadingTask.promise.then(resolve);
    });
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 1.0 });
    const opList = await page.getOperatorList();
    const svgGfx = new SVGGraphicsOverride(page.commonObjs, page.objs);
    svgGfx.embedFonts = false;

    const svg = await svgGfx.getSVG(opList, viewport);
    // Prepare canvas using PDF page dimensions
    svg.id = "svg-context";
    document.querySelector("#svg-context").replaceWith(svg);

    const svgRoot = document.querySelector("#svg-context");
    const pathDimensions = (pathElement) => {
      const clientRect = pathElement.getBBox();
      return {
        clientRect,
        area: clientRect.width * clientRect.height
      };
    };
    const findStatePath = () => {
      // iterate over svg:path elements, calling `getBoundingClientRect` on each
      // the state path is the largest of them , or more precisely
      // is the path whose distance to the root svg bounding box is minimized
      const paths = [...svgRoot.querySelectorAll("path")];
      const sortedPaths = paths
        .map((p) => ({
          path: p,
          dimensions: pathDimensions(p)
        }))
        .sort((a, b) => {
          return b.dimensions.area - a.dimensions.area;
        });
      const maxDimensions = sortedPaths[0].dimensions;
      const threshold = maxDimensions.area * 0.9;
      const stateCandidate = sortedPaths.find(
        (p) => p.dimensions.area < threshold
      );
      return stateCandidate;
    };
    const statePath = findStatePath();

    // get SVG bounding box
    const pathBox = statePath.path.getBoundingClientRect();
    const containerBox = statePath.path.ownerSVGElement.getBoundingClientRect();
    const pathBounds = {
      x: pathBox.left - containerBox.left,
      y: pathBox.top - containerBox.top,
      width: pathBox.width,
      height: pathBox.height
    };

    const stateGeo = stateGeos.features.find((f) => {
      const selectedState = document.querySelector("#state-list").value;
      return f.properties.NAME === selectedState;
    });

    //west, south, east, north order.
    const geoBounds = geojsonExtent(stateGeo);
    /*

    pixelWidth         pixelLeft
    ----------    =   ---------
    geoWidth           geoLeft


    geoContainer[1] = geoBounds.longitude - geoLeft
    */
    var scaleFactorX = (geoBounds[3] - geoBounds[1]) / pathBounds.width;
    var scaleFactorY = (geoBounds[2] - geoBounds[0]) / pathBounds.height;
    var offsetX = geoBounds[1] - pathBounds.left * scaleFactorX;
    var offsetY = geoBounds[0] + pathBounds.top * scaleFactorY;
    var transformedCoords = {
      x: -offsetX / scaleFactorX,
      y: -offsetY / scaleFactorY
    };

    // Calculate the latitude and longitude of the top left and bottom right corners of the map
    var topLeft = {
      latitude: transformedCoords.y,
      longitude: transformedCoords.x
    };
    var bottomRight = {
      latitude: transformedCoords.y + pathBounds.height * scaleFactorX,
      longitude: transformedCoords.x + pathBounds.width * scaleFactorY
    };

    debugger;

    // compute a transform that produces geo from SVG

    // find 0,0, x,y

    // pass into svg2geojson library

    // now we have a bounding box for the whole state
    // we also know the true bounding box in latitude and longitude
    // given the position of the state bounding box within the
    // parent bounding box, we can get the lat/long bounding box coordinates
    // of the parent
    const parentCoords = findParentCoords();

    // now we pass in the parentCoords to the SVG as meta elements
    // then call svg2geojson to convert the
  });

const findStatePath = () => {};
const findParentCoords = () => {};

