# Mental Calculation training for Kids (and Adults!)
Small console like game for practicing mental additions, substractions, multiplications and divisions for kids (grade 1 - 3).

The interface is minimal to reduce distractions. 
The highscores are stored locally in the local storage of the browser.

## Usage

### Optional parameter : `m`

| mode | description | 
| - | ----- |
| 1 (default) | Additions and substractions |
| 2 | Multiplications |
| 3 | Multiplication, Addition and Substraction |
| 4 | Division |
| 5 | Division, Addition and Substraction |
| 6 | Multiplication and Division |
| 7 | Multiplication, Division, Addition and Substraction |

### Optional parameter : `opA`, `opB`

Controls the maximum operand values in case of multiplication.
It'll go from opA = 2 to `opA` parameter then opB from opA to `opB` parameter.
The default value for both `opA` and `opB` is 10.

#### Divisions
The divisions are built using the `opA` and `opB` parameter indirectly. When building the question bank, the application construct divisions from multiplication. Example : with `2 x 3 = 6` the application construct the following divisions : `6 / 3 = 2` and `6 / 2 = 3`.

### Usage Examples :

Do only multiplications up to 3 : http://maths.codingtony.com/?m=2&opA=3

It will ask multiplications from 2 x 2 to 3 x 10