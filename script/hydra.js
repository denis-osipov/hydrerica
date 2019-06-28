/*

Script for dose rate calculation.

Uses ERICA Assessment Tool's assets.
ERICA version 1.3.1.33

*/

// Setting
var Setting = function() {
    this.isotopes = new Set();
    this.organisms = new Set();
    this.distributionCoefficients = {};
    this.concentrationRatios = {};
    this.media = ["Water", "Sediment"];
    this.habitats = {
            "Water-surface": [0.5, 0.0],
            "Water": [1.0, 0.0],
            "Sediment-surface": [0.5, 0.5],
            "Sediment": [0.0, 1.0]
        };
    // TODO: make occupancyFactors be object of objects
    // to unify table generations and getting input from user
    this.occupancyFactors = {};
    this.radiationWeightingFactors = [10.0, 1.0, 3.0];
    this.activityConcentrations = {};
    this.percentageDryWeight = 100;
    this.doseConversionCoefficients = {};
};

// Add isotopes and organisms to setting
Setting.prototype.addIsotope = function(isotope) {
    this.isotopes.add(isotope);
};

Setting.prototype.addOrganism = function(organism) {
    this.organisms.add(organism);
};

// Set radioecology parameters
Setting.prototype.setDistributionCoefficients = function(nuclide, value) {
    this.distributionCoefficients[nuclide] = value;
};

Setting.prototype.setConcentrationRatios = function(nuclide, organism, value) {
    this.concentrationRatios[nuclide] = {};
    this.concentrationRatios[nuclide][organism] = value;
};

/*
Set occupancy factors
values must be an array of 4 floats in [0, 1] in order:
    - Water-surface
    - Water
    - Sediment-surface
    - Sediment
*/
Setting.prototype.setOccupancyFactors = function(organism, values) {
    this.occupancyFactors[organism] = values;
};

/*
Set radiation weighting factors
values must be an array of 3 floats in [0, +inf) in order:
    - alpha
    - beta/gamma
    - low beta
*/
Setting.prototype.setRadiationWeightingFactors = function(values) {
    this.radiationWeightingFactors = values;
};

// Set activity concentrations
Setting.prototype.setActivityConcentrations = function(isotope, object, value) {
    this.activityConcentrations[isotope] = {};
    this.activityConcentrations[isotope][object] = value;
};

// Set percentage dry weight value for soil (value in [0, 100])
Setting.prototype.setPercentageDryWeight = function(value) {
    this.percentageDryWeight = value;
};

/*
Set dose conversion coefficients
values must be an array of 6 floats in [0, +inf) in order:
    - internal alpha
    - internal beta/gamma
    - internal low beta
    - external alpha
    - external beta/gamma
    - external low beta
*/
Setting.prototype.setDoseConversionCoefficients = function(isotope, organism, values) {
    this.doseConversionCoefficients[isotope] = {};
    this.doseConversionCoefficients[isotope][organism] = values;
}


// Result
var Result = function(setting) {
    // Make deep clone of setting to not alter it during calculation
    var deepClone = JSON.parse(JSON.stringify(setting, function(key, value) {
        // Convert sets to arrays (JSON.stringify doesn't work with sets)
        if (value instanceof Set) {
            return Array.from(value);
        }
        return value;
    }));
    for (property in deepClone) {
        this[property] = deepClone[property];
    }
};

// Fill missing data using ERICA's coefficients
Result.prototype.fillGaps = function(setting) {
    for (isotope of this.isotopes) {

        // Stop if there is no data about some isotope
        if (!this.activityConcentrations[isotope]) {
            console.log(`Can't find any data for ${isotope}`);
            continue;
        }

        // Fill Kd and activity concentrations for water and sediment
        // Perform calculations using data only for water or sediment
        var nuclide = isotope.split("-")[0];
        if (!this.distributionCoefficients[nuclide]) {
            this.distributionCoefficients[nuclide] = erica.kd[nuclide];
        }
        
        var kd = this.distributionCoefficients[nuclide];
        var activity = this.activityConcentrations[isotope];

        if (!activity["Water"] && activity["Sediment"]) {
            activity["Water"] = activity["Sediment"] / kd;
        }

        if (!activity["Sediment"] && activity["Water"]) {
            activity["Sediment"] = activity["Water"] * kd;
        }

        // Fill CR, activity concentrations and DCC for organisms
        if (!this.concentrationRatios[nuclide]) {
            this.concentrationRatios[nuclide] = {};
        }
        var cr = this.concentrationRatios[nuclide];

        if (!this.doseConversionCoefficients[isotope]) {
            this.doseConversionCoefficients[isotope] = {};
        }
        var dcc = this.doseConversionCoefficients[isotope];

        for (organism of this.organisms) {
            if (!cr[organism]) {
                cr[organism] = erica.cr[nuclide][organism];
            }
            if (!activity[organism] && activity["Water"]) {
                activity[organism] = activity["Water"] * cr[organism];
            }
            if (!dcc[organism]) {
                dcc[organism] = erica.dcc[isotope][organism];
            }
        }

    }

    // Fill occupancy factors
    for (organism of this.organisms) {
        if (!this.occupancyFactors[organism]) {
            this.occupancyFactors[organism] = erica.occ[organism];
        }
    }

};

// Get summary coefficients for calculations
Result.prototype.getCoefficients = function() {
    // Use aliases
    var dcc = this.doseConversionCoefficients;
    var wf = this.radiationWeightingFactors;

    this.internalCoefficients = {};
    this.externalCoefficients = {};
    
    for (isotope of this.isotopes) {
        this.internalCoefficients[isotope] = {};
        this.externalCoefficients[isotope] = {};
        for (organism of this.organisms) {
            coefs = [];
            dcc[isotope][organism].forEach(function(value, index) {
                coefs.push(value * wf[index % wf.length]);
            });
            this.internalCoefficients[isotope][organism] = coefs[0] + coefs[1] + coefs[2];
            this.externalCoefficients[isotope][organism] = coefs[3] + coefs[4] + coefs[5];
        }
    }
};

// Calculate internal dose rates
Result.prototype.getInternal = function() {
    this.internalDoseRates = {};
    for (isotope of this.isotopes) {
        this.internalDoseRates[isotope] = {};
        var activity = this.activityConcentrations[isotope];
        var coef = this.internalCoefficients[isotope];
        for (organism of this.organisms) {
            this.internalDoseRates[isotope][organism] = activity[organism] * coef[organism];
        }
    }
};

// Calculate external dose rates from each media
Result.prototype.getExternal = function() {
    this.externalDoseRates = {};
    for (isotope of this.isotopes) {
        this.externalDoseRates[isotope] = {};
        var activity = this.activityConcentrations[isotope];
        var coef = this.externalCoefficients[isotope];
        for (organism of this.organisms) {
            this.externalDoseRates[isotope][organism] = [
                activity["Water"] * coef[organism],
                activity["Sediment"] * coef[organism]
            ];
        }
    }

    // Calculate external dose rates for habitats
    this.habitatDoseRates = {};
    for (habitat in this.habitats) {
        var coef = this.habitats[habitat];
        var temp = {};
        for (isotope of this.isotopes) {
            temp[isotope] = {};
            for (organism of this.organisms) {
                var ext = this.externalDoseRates[isotope][organism];
                temp[isotope][organism] = ext[0] * coef[0] + ext[1] * coef[1];
            }
        }
        this.habitatDoseRates[habitat] = temp;
    }
};

// Calculate total dose rate using occupancy factors
Result.prototype.getTotal = function() {
    this.totalDoseRate = {};
    var habitats = Object.keys(this.habitats);
    for (isotope of this.isotopes) {
        this.totalDoseRate[isotope] = {};
        for (organism of this.organisms) {
            var occupancy = this.occupancyFactors[organism];
            var total = this.internalDoseRates[isotope][organism];
            for (var i = 0; i < habitats.length; i++) {
                total += this.habitatDoseRates[habitats[i]][isotope][organism] * occupancy[i];
            }
            this.totalDoseRate[isotope][organism] = total;
        }
    }
};

// Calculate dose rates
Result.prototype.calculate = function() {
    // Get missing data
    this.fillGaps();

    // Get summary coefficients
    this.getCoefficients();

    // Calculate internal and external dose rates
    this.getInternal();
    this.getExternal();
    this.getTotal();
};


// Create new setting
var setting = new Setting();


// Update list elements
var organismsList = document.getElementById("organisms");
organismsList.parentElement.addEventListener("click", function() {
    showInput("organisms");
});
var isotopesList = document.getElementById("isotopes");
isotopesList.parentElement.addEventListener("click", function() {
    showInput("isotopes");
})

var updateList = function(source, target) {
    target.innerHTML = "";
    for (item of source) {
        var itemEl = document.createElement("li");
        itemEl.textContent = item;
        target.appendChild(itemEl);
    }
};

// Show table for inputs
var showInput = function(type) {
    var appFrame = document.getElementsByClassName("app-frame")[0];
    var container = document.createElement("div");
    container.className = "input-box";
    appFrame.appendChild(container);

    var form = document.createElement("form");
    form.name = type;
    container.appendChild(form);

    var table = generateTable(type);
    form.appendChild(table);

    var confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "OK";
    confirmButton.addEventListener("click", getInput);
    form.appendChild(confirmButton);

    var resetButton = document.createElement("input");
    resetButton.type = "reset";
    resetButton.value = "Reset";
    form.appendChild(resetButton);
};


// Write user input into setting
var getInput = function(event) {
    var form = event.target.closest("form");
    var inputs = form.querySelectorAll("table input");
    if (form.name === "isotopes") {
        var target = setting.activityConcentrations;
        for (input of inputs) {
            if (input.value) {
                var names = input.name.replace(/_/, " ").split(".");
                var isotope = names[0];
                var object = names[1];
                if (!target[isotope]) {
                    target[isotope] = {};
                }
                target[isotope][object] = parseFloat(input.value);
            }
        }
    }
    else if (form.name === "organisms") {
        var target = setting.occupancyFactors;
        for (input of inputs) {
            var names = input.name.replace(/_/, " ").split(".");
            var organism = names[0];
            if (target[organism] === undefined ||
                target[organism].length === Object.keys(setting.habitats).length) {
                target[organism] = [];
            }
            target[organism].push(parseFloat(input.value));
        }

        // Fill data if not all value were given
        for (organism in target) {
            if (!target[organism].every(isNaN)) {
                target[organism].forEach(function(value, index, array) {
                    if (isNaN(value)) {
                        array[index] = 0;
                    }
                });
            }
        }

    }
    event.target.closest("div").remove();
};


var generateTable = function(type) {
    var table = document.createElement("table");
    var caption = document.createElement("caption");
    table.appendChild(caption);
    var rows;
    var cols;

    if (type === "isotopes") {
        caption.textContent = "Enter activity concentrations, Bq/kg";
        rows = Array.from(setting.isotopes);
        cols = setting.media.concat(Array.from(setting.organisms));
    }
    else if (type === "organisms") {
        caption.textContent = "Enter occupancy factors for organisms";
        rows = Array.from(setting.organisms);
        cols = Object.keys(setting.habitats);
    }

    // Generate header
    var tableHeader = document.createElement("thead");
    var headerRow = document.createElement("tr");
    headerRow.appendChild(document.createElement("td"));
    for (col of cols) {
        var header = document.createElement("th");
        header.textContent = col;
        header.scope = "col";
        headerRow.appendChild(header);
    }
    tableHeader.appendChild(headerRow);
    table.appendChild(tableHeader);

    // Generate body
    var tableBody = document.createElement("tbody");
    for (row of rows) {
        var bodyRow = document.createElement("tr");
        var header = document.createElement("th");
        header.textContent = row;
        header.scope = "row";
        bodyRow.appendChild(header);
        for (col of cols) {
            var cell = document.createElement("td");
            var value = document.createElement("input");
            value.type = "number";
            value.name = (row + "." + col).replace(/ /g, "_");
            value.min = "0";
            if (type === "organisms") {
                // TODO: Don't allow input more than 1 in total
                value.max = "1";
            }
            // allow decimals
            value.step = "0.001";

            // TODO: change when reimplement occupancyFactors
            if (type === "isotopes") {
                if (setting.activityConcentrations[row]) {
                    value.defaultValue = setting.activityConcentrations[row][col];
                }
            }
            else if (type === "organisms") {
                if (setting.occupancyFactors[row]) {
                    value.defaultValue = setting.occupancyFactors[row].shift();
                }
            }

            cell.appendChild(value);
            bodyRow.append(cell);
        }
        tableBody.appendChild(bodyRow);
    }
    table.appendChild(tableBody);

    return table;
};


// Add item selector right before target element (button)
var addItemSelector = function(event, array) {

    // Parent container
    var newItemSelector = document.createElement("div");
    newItemSelector.className = "selector";  // for styling

    // Selector
    var selector = document.createElement("select");
    for (var i = 0; i < array.length; i++) {
        var option = document.createElement("option");
        option.textContent = array[i];
        selector.appendChild(option);
    }
    newItemSelector.appendChild(selector);

    // Item button
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "^";
    button.addEventListener("click", function(e) {
        var value = e.target.previousSibling.value;
        if (event.target.id === "add-isotope") {
            setting.addIsotope(value);
            updateList(setting.isotopes, isotopes);
        }
        else {
            setting.addOrganism(value);
            updateList(setting.organisms, organisms);
        }
    });
    newItemSelector.appendChild(button);

    var target = event.target;
    target.parentNode.insertBefore(newItemSelector, target);
};


// organisms fieldset
var addOrganismButton = document.getElementById("add-organism");
addOrganismButton.addEventListener("click", function(e){
    addItemSelector(e, erica.organisms)
});

// isotopes fieldset
var addIsotopeButton = document.getElementById("add-isotope");
addIsotopeButton.addEventListener("click", function(e){
    addItemSelector(e, erica.isotopes)
});

// Calculate button
var calculateButton = document.getElementById("calculate");
calculateButton.addEventListener("click", setting.calculate);
